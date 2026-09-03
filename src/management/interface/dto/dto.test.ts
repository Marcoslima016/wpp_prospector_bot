import { describe, expect, it } from "vitest";
import {
  ContractViolationError,
  checkContract,
} from "../../infrastructure/http/reply-with-contract.ts";
import {
  handoffResultSchema,
  resumeResultSchema,
  sendMessageResultSchema,
} from "./conversation-actions.dto.ts";
import { conversationDetailSchema, conversationListPageSchema } from "./conversation.dto.ts";
import { prospectLeadResultSchema, registerLeadResultSchema } from "./lead.dto.ts";
import { consumptionSeriesSchema } from "./consumption.dto.ts";
import { EMPTY_OVERVIEW, overviewSchema } from "./overview.dto.ts";

const listPage = {
  items: [
    {
      leadPhone: "5511988887777",
      state: "active",
      leadIntent: "interested",
      leadQualification: "warm",
      turnCount: 3,
      lastActivityAt: "2026-09-02T12:00:00.000Z",
      hasPendingInbound: true,
      quotedPlan: null,
    },
  ],
  pageSize: 25,
  nextCursor: null,
};

describe("checkContract", () => {
  it("deixa passar um payload conforme e devolve o dado parseado", () => {
    expect(() => checkContract(conversationListPageSchema, listPage, "test")).not.toThrow();
    expect(checkContract(conversationListPageSchema, listPage, "test")).toEqual(listPage);
  });

  it("sinaliza campo faltando quando a verificação está ligada", () => {
    const { pageSize: _omit, ...missing } = listPage;
    expect(() => checkContract(conversationListPageSchema, missing, "test")).toThrow(
      ContractViolationError,
    );
  });

  it("sinaliza tipo errado quando a verificação está ligada", () => {
    const wrong = { ...listPage, pageSize: "25" };
    expect(() => checkContract(conversationListPageSchema, wrong, "test")).toThrow(
      ContractViolationError,
    );
  });

  it("em produção deixa passar sem validar", () => {
    const wrong = { ...listPage, pageSize: "25" } as never;
    expect(() => checkContract(conversationListPageSchema, wrong, "production")).not.toThrow();
  });
});

describe("DTOs de gestão", () => {
  it("conversationDetailSchema aceita um detalhe completo", () => {
    const detail = {
      leadPhone: "5511988887777",
      state: "awaitingHuman",
      leadIntent: "needs_more_info",
      leadQualification: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: "essencial",
      hasPendingInbound: false,
      hasAbandonedInbound: true,
      turnCount: 2,
      lastActivityAt: "2026-09-02T12:00:00.000Z",
      turns: [
        { direction: "inbound", text: "oi", timestamp: "2026-09-02T11:59:00.000Z", pendingDecision: false },
        {
          direction: "outbound",
          text: "olá!",
          timestamp: "2026-09-02T12:00:00.000Z",
          origin: "bot",
          leadIntent: "needs_more_info",
          leadQualification: null,
          reasoning: "x",
          recommendedModules: [],
          interestedModules: [],
          quotedPlan: "essencial",
        },
      ],
    };
    expect(conversationDetailSchema.safeParse(detail).success).toBe(true);
  });

  it("conversationDetailSchema rejeita um turno outbound sem `origin`", () => {
    const detail = {
      leadPhone: "5511988887777",
      state: "active",
      leadIntent: "unknown",
      leadQualification: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
      hasPendingInbound: false,
      hasAbandonedInbound: false,
      turnCount: 1,
      lastActivityAt: "2026-09-02T12:00:00.000Z",
      turns: [
        { direction: "outbound", text: "olá!", timestamp: "2026-09-02T12:00:00.000Z" },
      ],
    };
    expect(conversationDetailSchema.safeParse(detail).success).toBe(false);
  });

  it("handoffResult/resumeResult reusam o contrato de detalhe da conversa", () => {
    const detail = {
      leadPhone: "5511988887777",
      state: "awaitingHuman",
      leadIntent: "unknown",
      leadQualification: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
      hasPendingInbound: false,
      hasAbandonedInbound: false,
      turnCount: 1,
      lastActivityAt: "2026-09-02T12:00:00.000Z",
      turns: [
        {
          direction: "outbound",
          text: "olá!",
          timestamp: "2026-09-02T12:00:00.000Z",
          origin: "operator",
        },
      ],
    };
    expect(handoffResultSchema.safeParse(detail).success).toBe(true);
    expect(resumeResultSchema.safeParse({ ...detail, state: "active" }).success).toBe(true);
  });

  it("sendMessageResultSchema aceita a confirmação com o turno do operador", () => {
    const result = {
      sent: true,
      turn: {
        direction: "outbound",
        text: "mensagem do operador",
        timestamp: "2026-09-02T12:00:00.000Z",
        origin: "operator",
      },
    };
    expect(sendMessageResultSchema.safeParse(result).success).toBe(true);
  });

  it("sendMessageResultSchema rejeita `origin` fora do enum", () => {
    const result = {
      sent: true,
      turn: {
        direction: "outbound",
        text: "x",
        timestamp: "2026-09-02T12:00:00.000Z",
        origin: "robot",
      },
    };
    expect(sendMessageResultSchema.safeParse(result).success).toBe(false);
  });

  it("consumptionSeriesSchema aceita uma série vazia", () => {
    const empty = {
      groupBy: "day",
      range: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-02T00:00:00.000Z" },
      rows: [],
      total: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        estimatedCostUsd: 0,
        costPartial: false,
      },
    };
    expect(consumptionSeriesSchema.safeParse(empty).success).toBe(true);
  });

  it("EMPTY_OVERVIEW bate com overviewSchema", () => {
    expect(overviewSchema.safeParse(EMPTY_OVERVIEW).success).toBe(true);
    expect(EMPTY_OVERVIEW.conversationsByState).toEqual({ active: 0, ended: 0, awaitingHuman: 0 });
  });

  const leadResource = {
    phone: "+5511988887777",
    displayName: "Ana",
    source: null,
    notes: null,
    prospectingState: "pending",
    firstContactAt: null,
    repliedAt: null,
  };

  it("registerLeadResultSchema aceita um lead recém-cadastrado", () => {
    expect(registerLeadResultSchema.safeParse(leadResource).success).toBe(true);
  });

  it("registerLeadResultSchema rejeita `prospectingState` fora do enum", () => {
    expect(
      registerLeadResultSchema.safeParse({ ...leadResource, prospectingState: "queued" }).success,
    ).toBe(false);
  });

  it("prospectLeadResultSchema aceita o disparo com wamid e o lead em sent", () => {
    const result = {
      wamid: "wamid.tmpl.1",
      alreadyProspected: false,
      lead: {
        ...leadResource,
        prospectingState: "sent",
        firstContactAt: "2026-09-03T12:00:00.000Z",
      },
    };
    expect(prospectLeadResultSchema.safeParse(result).success).toBe(true);
  });

  it("prospectLeadResultSchema aceita wamid null com alreadyProspected true (idempotência)", () => {
    const result = {
      wamid: null,
      alreadyProspected: true,
      lead: { ...leadResource, prospectingState: "sent" },
    };
    expect(prospectLeadResultSchema.safeParse(result).success).toBe(true);
  });

  it("conversationDetailOutboundTurn aceita `kind: \"prospecting\"` em turno de operador", () => {
    const detail = {
      leadPhone: "+5511988887777",
      state: "active",
      leadIntent: "unknown",
      leadQualification: null,
      recommendedModules: [],
      interestedModules: [],
      quotedPlan: null,
      hasPendingInbound: false,
      hasAbandonedInbound: false,
      turnCount: 1,
      lastActivityAt: "2026-09-03T12:00:00.000Z",
      turns: [
        {
          direction: "outbound",
          text: "[primeiro contato]",
          timestamp: "2026-09-03T12:00:00.000Z",
          origin: "operator",
          kind: "prospecting",
        },
      ],
    };
    expect(conversationDetailSchema.safeParse(detail).success).toBe(true);
  });
});
