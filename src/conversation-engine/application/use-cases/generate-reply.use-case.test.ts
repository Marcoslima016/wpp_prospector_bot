import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotDecisionInput } from "../../domain/bot-decision.ts";
import { Conversation } from "../../domain/conversation.ts";
import { ReplyStrategy } from "../../domain/reply-strategy.ts";
import { LlmClientError } from "../errors.ts";
import type {
  BusinessContextInput,
  BusinessContextProvider,
} from "../ports/business-context.port.ts";
import type { ConversationRepositoryPort } from "../ports/conversation-repository.port.ts";
import { fakeLlmResponse } from "../ports/llm-client.fake.ts";
import type { LlmClientPort, LlmRequest, LlmResponse, LlmUsage } from "../ports/llm-client.port.ts";
import type { Logger } from "../ports/logger.port.ts";
import type { ReplySenderPort } from "../ports/reply-sender.port.ts";
import type { LlmUsageEvent, UsageRecorderPort } from "../ports/usage-recorder.port.ts";
import { GenerateReplyUseCase } from "./generate-reply.use-case.ts";

class RecordingUsageRecorder implements UsageRecorderPort {
  events: LlmUsageEvent[] = [];
  constructor(private readonly fail = false) {}

  recordLlmCall(event: LlmUsageEvent): Promise<void> {
    this.events.push(event);
    return this.fail ? Promise.reject(new Error("falha ao registrar consumo")) : Promise.resolve();
  }
}

class FakeBusinessContext implements BusinessContextProvider {
  calls: BusinessContextInput[] = [];
  constructor(private readonly value: string | Error = "CONTEXTO DE NEGÓCIO") {}

  getContext(input: BusinessContextInput): Promise<string> {
    this.calls.push(input);
    if (this.value instanceof Error) return Promise.reject(this.value);
    return Promise.resolve(this.value);
  }
}

const PHONE = "+5511999999999";
const t0 = new Date("2026-08-27T12:00:00.000Z");

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

class FakeRepository implements ConversationRepositoryPort {
  private store = new Map<string, Conversation>();
  saved: Conversation[] = [];

  seed(conversation: Conversation): void {
    this.store.set(conversation.leadPhone, conversation);
  }

  load(leadPhone: string): Promise<Conversation | null> {
    return Promise.resolve(this.store.get(leadPhone) ?? null);
  }

  save(conversation: Conversation): Promise<void> {
    this.store.set(conversation.leadPhone, conversation);
    this.saved.push(conversation);
    return Promise.resolve();
  }

  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve(
      [...this.store.values()].filter((c) => c.pendingInboundTurns.length > 0),
    );
  }
}

class ScriptedLlmClient implements LlmClientPort {
  calls: LlmRequest[] = [];
  constructor(private readonly script: Array<LlmResponse | Error>) {}

  generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (next === undefined) throw new Error("ScriptedLlmClient: sem respostas restantes");
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }
}

class RecordingReplySender implements ReplySenderPort {
  sent: Array<{ to: string; body: string }> = [];
  constructor(private readonly failBodies: Set<string> = new Set()) {}

  send(to: string, body: string): Promise<void> {
    if (this.failBodies.has(body)) {
      return Promise.reject(new Error(`falha simulada ao enviar: ${body}`));
    }
    this.sent.push({ to, body });
    return Promise.resolve();
  }
}

function decisionJson(
  overrides: Partial<BotDecisionInput> = {},
  usage: Partial<LlmUsage> = {},
): LlmResponse {
  const decision: BotDecisionInput = {
    replyMessages: ["resposta padrão"],
    endConversation: false,
    leadIntent: "interested",
    leadQualification: "warm",
    handoffToHuman: false,
    reasoning: "lead demonstrou interesse",
    ...overrides,
  };
  return fakeLlmResponse(JSON.stringify(decision), usage);
}

function strategy(): ReplyStrategy {
  return new ReplyStrategy({ promptText: "PROMPT", model: "claude-sonnet-5", historyTurns: 20 });
}

function seededConversation(repo: FakeRepository, messageIds: string[]): void {
  const conversation = Conversation.createNew(PHONE);
  messageIds.forEach((id, i) =>
    conversation.recordInboundTurn({ text: `mensagem ${i}`, timestamp: t0, messageId: id }),
  );
  repo.seed(conversation);
}

let repo: FakeRepository;
let logger: Logger;

beforeEach(() => {
  repo = new FakeRepository();
  logger = fakeLogger();
});

function build(
  llm: ScriptedLlmClient,
  sender: ReplySenderPort,
  businessContextProvider: BusinessContextProvider = new FakeBusinessContext(),
  usageRecorder: UsageRecorderPort = new RecordingUsageRecorder(),
): GenerateReplyUseCase {
  return new GenerateReplyUseCase({
    repository: repo,
    replyStrategy: strategy(),
    llmClient: llm,
    replySender: sender,
    businessContextProvider,
    usageRecorder,
    logger,
    clock: () => t0,
    retryBackoffMs: 0,
  });
}

describe("GenerateReplyUseCase", () => {
  it("mensagem única do lead gera uma única resposta enviada", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      decisionJson({ replyMessages: ["Olá! Como posso ajudar?"] }),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(sender.sent).toEqual([{ to: PHONE, body: "Olá! Como posso ajudar?" }]);
    expect(repo.saved).toHaveLength(1);
  });

  it("rajada sobre o mesmo assunto (decisão com 1 mensagem) gera uma única resposta", async () => {
    seededConversation(repo, ["wamid.1", "wamid.2", "wamid.3"]);
    const llm = new ScriptedLlmClient([decisionJson({ replyMessages: ["Resposta consolidada"] })]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1", "wamid.2", "wamid.3"]);

    expect(sender.sent.map((s) => s.body)).toEqual(["Resposta consolidada"]);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.messages.filter((m) => m.role === "user")).toHaveLength(3);
  });

  it("assuntos distintos geram múltiplas respostas na ordem da decisão", async () => {
    seededConversation(repo, ["wamid.1", "wamid.2"]);
    const llm = new ScriptedLlmClient([
      decisionJson({
        replyMessages: ["Sobre o preço: é sob medida.", "Sobre a integração: sim, temos API."],
      }),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1", "wamid.2"]);

    expect(sender.sent.map((s) => s.body)).toEqual([
      "Sobre o preço: é sob medida.",
      "Sobre a integração: sim, temos API.",
    ]);
  });

  it("ignora messageId já processado (sem turno pendente) sem chamar o LLM", async () => {
    const conversation = Conversation.createNew(PHONE);
    conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
    conversation.clearPending(); // já respondido anteriormente
    repo.seed(conversation);
    const llm = new ScriptedLlmClient([]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(llm.calls).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
  });

  it("falha de LLM após a tentativa adicional: sem resposta e erro logado", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      new LlmClientError("timeout"),
      new LlmClientError("timeout de novo"),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(llm.calls).toHaveLength(2);
    expect(sender.sent).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Falha ao interpretar"),
      expect.objectContaining({ leadPhone: PHONE }),
    );
  });

  it("saída fora do schema (mesmo após retry): sem resposta", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      fakeLlmResponse("{ isso não é uma decisão }"),
      fakeLlmResponse(JSON.stringify({ replyMessages: 123 })),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(llm.calls).toHaveLength(2);
    expect(sender.sent).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("endConversation marca a conversa como encerrada e persiste", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      decisionJson({ replyMessages: ["Até mais!"], endConversation: true }),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    const saved = repo.saved[0]!;
    expect(saved.state).toBe("ended");
    expect(sender.sent.map((s) => s.body)).toEqual(["Até mais!"]);
  });

  it("handoffToHuman: envia o turno, marca awaitingHuman e loga", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      decisionJson({
        replyMessages: ["Vou te transferir para um vendedor."],
        handoffToHuman: true,
      }),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    const saved = repo.saved[0]!;
    expect(saved.state).toBe("awaitingHuman");
    expect(saved.acceptsAutomatedReplies).toBe(false);
    expect(sender.sent).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("atendimento humano"),
      expect.objectContaining({ leadPhone: PHONE }),
    );
  });

  it("falha ao enviar uma mensagem do lote não impede o envio das demais", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      decisionJson({ replyMessages: ["primeira", "segunda", "terceira"] }),
    ]);
    const sender = new RecordingReplySender(new Set(["segunda"]));

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(sender.sent.map((s) => s.body)).toEqual(["primeira", "terceira"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Falha ao enviar"),
      expect.objectContaining({ leadPhone: PHONE }),
    );
  });

  it("recupera na tentativa adicional quando a primeira chamada ao LLM falha", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([
      new LlmClientError("erro transitório"),
      decisionJson({ replyMessages: ["Deu certo na segunda"] }),
    ]);
    const sender = new RecordingReplySender();

    await build(llm, sender).execute(PHONE, ["wamid.1"]);

    expect(llm.calls).toHaveLength(2);
    expect(sender.sent.map((s) => s.body)).toEqual(["Deu certo na segunda"]);
  });

  it("recupera o contexto de negócio antes da geração e o repassa ao prompt", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([decisionJson()]);
    const sender = new RecordingReplySender();
    const businessContext = new FakeBusinessContext("PINNED + PLANOS");

    await build(llm, sender, businessContext).execute(PHONE, ["wamid.1"]);

    expect(businessContext.calls).toHaveLength(1);
    expect(businessContext.calls[0]!.newMessages).toEqual(["mensagem 0"]);
    const system = llm.calls[0]!.system;
    const systemText = typeof system === "string" ? system : system.map((b) => b.text).join("\n");
    expect(systemText).toContain("PINNED + PLANOS");
  });

  it("segue gerando a resposta mesmo se a recuperação do contexto de negócio falhar", async () => {
    seededConversation(repo, ["wamid.1"]);
    const llm = new ScriptedLlmClient([decisionJson({ replyMessages: ["Resposta mesmo assim"] })]);
    const sender = new RecordingReplySender();
    const businessContext = new FakeBusinessContext(new Error("índice indisponível"));

    await build(llm, sender, businessContext).execute(PHONE, ["wamid.1"]);

    expect(sender.sent.map((s) => s.body)).toEqual(["Resposta mesmo assim"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("contexto de negócio"),
      expect.objectContaining({ leadPhone: PHONE }),
    );
  });

  describe("registro de consumo (best-effort)", () => {
    it("registra um evento reply-generation com o leadPhone e o usage da chamada", async () => {
      seededConversation(repo, ["wamid.1"]);
      const llm = new ScriptedLlmClient([decisionJson({}, { inputTokens: 1234 })]);
      const recorder = new RecordingUsageRecorder();

      await build(llm, new RecordingReplySender(), undefined, recorder).execute(PHONE, ["wamid.1"]);

      expect(recorder.events).toHaveLength(1);
      expect(recorder.events[0]).toMatchObject({
        callType: "reply-generation",
        leadPhone: PHONE,
        usage: { inputTokens: 1234 },
      });
    });

    it("não registra quando a chamada ao LLM falha; registra só a bem-sucedida no retry", async () => {
      seededConversation(repo, ["wamid.1"]);
      const llm = new ScriptedLlmClient([new LlmClientError("timeout"), decisionJson()]);
      const recorder = new RecordingUsageRecorder();

      await build(llm, new RecordingReplySender(), undefined, recorder).execute(PHONE, ["wamid.1"]);

      expect(recorder.events).toHaveLength(1);
    });

    it("registra um evento por chamada faturada: 2 quando a 1ª resposta falha no schema", async () => {
      seededConversation(repo, ["wamid.1"]);
      const llm = new ScriptedLlmClient([fakeLlmResponse("{ não é json }"), decisionJson()]);
      const recorder = new RecordingUsageRecorder();

      await build(llm, new RecordingReplySender(), undefined, recorder).execute(PHONE, ["wamid.1"]);

      expect(recorder.events).toHaveLength(2);
      expect(recorder.events.map((e) => e.callType)).toEqual([
        "reply-generation",
        "reply-generation",
      ]);
    });

    it("falha ao registrar consumo não impede a decisão, o save nem o envio", async () => {
      seededConversation(repo, ["wamid.1"]);
      const llm = new ScriptedLlmClient([decisionJson({ replyMessages: ["Enviada assim mesmo"] })]);
      const sender = new RecordingReplySender();

      await build(llm, sender, undefined, new RecordingUsageRecorder(true)).execute(PHONE, [
        "wamid.1",
      ]);

      expect(sender.sent.map((s) => s.body)).toEqual(["Enviada assim mesmo"]);
      expect(repo.saved).toHaveLength(1);
    });

    it("recorder que não registra nada (no-op) não altera o turno", async () => {
      seededConversation(repo, ["wamid.1"]);
      const llm = new ScriptedLlmClient([decisionJson({ replyMessages: ["Olá"] })]);
      const sender = new RecordingReplySender();
      const noop: UsageRecorderPort = { recordLlmCall: () => Promise.resolve() };

      await build(llm, sender, undefined, noop).execute(PHONE, ["wamid.1"]);

      expect(sender.sent.map((s) => s.body)).toEqual(["Olá"]);
    });
  });
});
