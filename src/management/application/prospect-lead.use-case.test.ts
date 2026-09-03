import { afterEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "../../conversation-engine/domain/conversation.ts";
import { LeadSerialQueue } from "../../conversation-engine/infrastructure/inbound/lead-serial-queue.ts";
import { WhatsAppApiError } from "../../whatsapp-connectivity/application/errors.ts";
import type { SendOutboundMessageUseCase } from "../../whatsapp-connectivity/application/use-cases/send-outbound-message.use-case.ts";
import type { OutboundMessageInput } from "../../whatsapp-connectivity/domain/outbound-message.ts";
import type { SentMessage } from "../../whatsapp-connectivity/application/ports/whatsapp-gateway.port.ts";
import { buildConversation } from "../test-support/conversation-fixtures.ts";
import { InMemoryConversationRepository } from "../test-support/in-memory-conversation-repository.ts";
import { InMemoryLeadRepository } from "../test-support/in-memory-lead-repository.ts";
import {
  FirstContactTemplateNotConfiguredError,
  InvalidLeadPhoneError,
  LeadNotFoundError,
  ProspectingGatewayError,
} from "./errors.ts";
import type { FirstContactTemplateConfig } from "./first-contact-template.ts";
import type { AdminActionEntry } from "./ports/admin-action-audit.port.ts";
import type { Logger } from "./ports/logger.port.ts";
import { ProspectLeadUseCase } from "./prospect-lead.use-case.ts";

const PHONE = "+5511988887777";
const NOW = new Date("2026-09-03T12:00:00.000Z");

class FakeSendTemplate {
  readonly calls: OutboundMessageInput[] = [];
  private error: Error | undefined;

  failWith(error: Error): void {
    this.error = error;
  }

  execute(input: OutboundMessageInput): Promise<SentMessage> {
    this.calls.push(input);
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve({ wamid: `wamid.tmpl.${this.calls.length}` });
  }

  asUseCase(): SendOutboundMessageUseCase {
    return this as unknown as SendOutboundMessageUseCase;
  }
}

class FakeAudit {
  readonly calls: AdminActionEntry[] = [];
  private shouldFail = false;

  failNext(): void {
    this.shouldFail = true;
  }

  record(entry: AdminActionEntry): Promise<void> {
    if (this.shouldFail) {
      this.shouldFail = false;
      return Promise.reject(new Error("auditoria indisponível"));
    }
    this.calls.push(entry);
    return Promise.resolve();
  }
}

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

interface Harness {
  leads: InMemoryLeadRepository;
  conversations: InMemoryConversationRepository;
  queue: LeadSerialQueue;
  sendTemplate: FakeSendTemplate;
  audit: FakeAudit;
  logger: Logger;
  useCase: ProspectLeadUseCase;
}

function buildHarness(template?: Partial<FirstContactTemplateConfig>): Harness {
  const leads = new InMemoryLeadRepository();
  const conversations = new InMemoryConversationRepository();
  const queue = new LeadSerialQueue();
  const sendTemplate = new FakeSendTemplate();
  const audit = new FakeAudit();
  const logger = fakeLogger();

  const useCase = new ProspectLeadUseCase({
    leads,
    conversations,
    queue,
    sendTemplate: sendTemplate.asUseCase(),
    template: { name: "primeiro_contato", lang: "pt_BR", paramKeys: [], ...template },
    audit,
    logger,
    clock: () => NOW,
  });

  return { leads, conversations, queue, sendTemplate, audit, logger, useCase };
}

function outboundTurns(conversation: Conversation): ReadonlyArray<{ origin?: string; kind?: string }> {
  return conversation.turns
    .filter((turn) => turn.direction === "outbound")
    .map((turn) => ({ origin: turn.origin, kind: turn.kind }));
}

describe("ProspectLeadUseCase", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispara o primeiro contato: envia o template, semeia a conversa, marca sent e audita", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE, displayName: "Ana" });

    const outcome = await h.useCase.prospect(PHONE, { parameters: ["Ana"] });

    expect(outcome).toMatchObject({ wamid: "wamid.tmpl.1", alreadyProspected: false });
    expect(outcome.lead.prospectingState).toBe("sent");
    expect(h.sendTemplate.calls).toEqual([
      { to: PHONE, templateName: "primeiro_contato", languageCode: "pt_BR", parameters: ["Ana"] },
    ]);

    const conversation = await h.conversations.load(PHONE);
    expect(conversation).not.toBeNull();
    expect(outboundTurns(conversation!)).toEqual([{ origin: "operator", kind: "prospecting" }]);

    const lead = await h.leads.findByPhone(PHONE);
    expect(lead).toMatchObject({ prospectingState: "sent", firstContactWamid: "wamid.tmpl.1" });
    expect(h.audit.calls).toEqual([
      { actor: "operator", action: "prospect", leadPhone: PHONE, occurredAt: NOW },
    ]);
  });

  it("mapeia objeto de parâmetros para array posicional pelos paramKeys", async () => {
    const h = buildHarness({ paramKeys: ["nome", "empresa"] });
    h.leads.seed({ phone: PHONE });

    await h.useCase.prospect(PHONE, { parameters: { empresa: "ACME", nome: "Ana" } });

    expect(h.sendTemplate.calls[0]!.parameters).toEqual(["Ana", "ACME"]);
  });

  it("lead não cadastrado → LeadNotFoundError", async () => {
    const h = buildHarness();

    await expect(h.useCase.prospect(PHONE)).rejects.toBeInstanceOf(LeadNotFoundError);
    expect(h.sendTemplate.calls).toHaveLength(0);
  });

  it("telefone fora de E.164 → InvalidLeadPhoneError", async () => {
    const h = buildHarness();

    await expect(h.useCase.prospect("11988887777")).rejects.toBeInstanceOf(InvalidLeadPhoneError);
  });

  it("template não configurado → FirstContactTemplateNotConfiguredError, sem gateway e sem mudar estado", async () => {
    const h = buildHarness({ name: "  " });
    h.leads.seed({ phone: PHONE });

    await expect(h.useCase.prospect(PHONE)).rejects.toBeInstanceOf(
      FirstContactTemplateNotConfiguredError,
    );
    expect(h.sendTemplate.calls).toHaveLength(0);
    expect((await h.leads.findByPhone(PHONE))!.prospectingState).toBe("pending");
  });

  it("rejeição do gateway → ProspectingGatewayError, marca failed e não semeia turno", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE });
    h.sendTemplate.failWith(new WhatsAppApiError("Template não aprovado", { code: "132001" }));

    await expect(h.useCase.prospect(PHONE)).rejects.toBeInstanceOf(ProspectingGatewayError);

    expect((await h.leads.findByPhone(PHONE))!.prospectingState).toBe("failed");
    expect(await h.conversations.load(PHONE)).toBeNull();
    expect(h.audit.calls).toHaveLength(0);
  });

  it("idempotente sem force quando o lead já está em sent", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE, prospectingState: "sent", firstContactWamid: "wamid.old" });

    const outcome = await h.useCase.prospect(PHONE);

    expect(outcome).toMatchObject({ wamid: null, alreadyProspected: true });
    expect(h.sendTemplate.calls).toHaveLength(0);
  });

  it("idempotente sem force quando o lead já está em replied", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE, prospectingState: "replied" });

    const outcome = await h.useCase.prospect(PHONE);

    expect(outcome.alreadyProspected).toBe(true);
    expect(h.sendTemplate.calls).toHaveLength(0);
  });

  it("force reenvia o template e acrescenta um novo turno de prospecção", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE, prospectingState: "sent", firstContactWamid: "wamid.old" });
    await h.conversations.save(buildConversation({ leadPhone: PHONE }));

    const outcome = await h.useCase.prospect(PHONE, { force: true });

    expect(outcome.wamid).toBe("wamid.tmpl.1");
    expect(h.sendTemplate.calls).toHaveLength(1);
    const conversation = await h.conversations.load(PHONE);
    expect(outboundTurns(conversation!)).toEqual([
      { origin: "bot", kind: undefined },
      { origin: "operator", kind: "prospecting" },
    ]);
  });

  it("um lead em failed pode ser disparado de novo sem force", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE, prospectingState: "failed" });

    const outcome = await h.useCase.prospect(PHONE);

    expect(outcome.wamid).toBe("wamid.tmpl.1");
    expect((await h.leads.findByPhone(PHONE))!.prospectingState).toBe("sent");
  });

  it("conversa já existente recebe apenas o turno acrescido", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE });
    await h.conversations.save(buildConversation({ leadPhone: PHONE }));

    await h.useCase.prospect(PHONE);

    const conversation = await h.conversations.load(PHONE);
    expect(outboundTurns(conversation!)).toEqual([
      { origin: "bot", kind: undefined },
      { origin: "operator", kind: "prospecting" },
    ]);
  });

  it("falha ao auditar é logada e não falha o disparo", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE });
    h.audit.failNext();

    const outcome = await h.useCase.prospect(PHONE);

    expect(outcome.lead.prospectingState).toBe("sent");
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("o envio + a semeadura rodam na fila serial do lead", async () => {
    const h = buildHarness();
    h.leads.seed({ phone: PHONE });

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const blocking = h.queue.run(PHONE, () => gate);

    const prospectPromise = h.useCase.prospect(PHONE);
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.sendTemplate.calls).toHaveLength(0);

    release();
    await blocking;
    await prospectPromise;
    expect(h.sendTemplate.calls).toHaveLength(1);
  });
});
