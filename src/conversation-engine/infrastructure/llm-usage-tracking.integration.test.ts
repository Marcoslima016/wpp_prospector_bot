import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationRepositoryPort } from "../application/ports/conversation-repository.port.ts";
import { fakeLlmResponse } from "../application/ports/llm-client.fake.ts";
import type {
  LlmClientPort,
  LlmRequest,
  LlmResponse,
} from "../application/ports/llm-client.port.ts";
import type { Logger } from "../application/ports/logger.port.ts";
import type { ReplySenderPort } from "../application/ports/reply-sender.port.ts";
import type { UsageRecorderPort } from "../application/ports/usage-recorder.port.ts";
import { GenerateReplyUseCase } from "../application/use-cases/generate-reply.use-case.ts";
import { Conversation } from "../domain/conversation.ts";
import { ReplyStrategy } from "../domain/reply-strategy.ts";
import { openDatabase } from "../../shared/persistence/sqlite/open-database.ts";
import { LexicalIndex } from "./knowledge/lexical-index.ts";
import { LexicalRetrievalBusinessContext } from "./knowledge/lexical-retrieval.business-context.ts";
import { NoopUsageRecorder } from "./persistence/noop-usage-recorder.ts";
import { SqliteUsageRecorder } from "./persistence/sqlite-usage-recorder.ts";

const PHONE = "+5511988887777";
const t0 = new Date("2026-09-02T12:00:00.000Z");
const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let db: DatabaseSync;

afterEach(() => {
  db.close();
});

class InMemoryRepository implements ConversationRepositoryPort {
  private store = new Map<string, Conversation>();
  seed(c: Conversation): void {
    this.store.set(c.leadPhone, c);
  }
  load(leadPhone: string): Promise<Conversation | null> {
    return Promise.resolve(this.store.get(leadPhone) ?? null);
  }
  save(c: Conversation): Promise<void> {
    this.store.set(c.leadPhone, c);
    return Promise.resolve();
  }
  findConversationsWithPendingInbound(): Promise<Conversation[]> {
    return Promise.resolve([]);
  }
}

class ScriptedLlmClient implements LlmClientPort {
  private i = 0;
  constructor(private readonly script: LlmResponse[]) {}
  generate(_request: LlmRequest): Promise<LlmResponse> {
    const next = this.script[this.i++];
    if (!next) throw new Error("ScriptedLlmClient: sem respostas restantes");
    return Promise.resolve(next);
  }
}

const NULL_SENDER: ReplySenderPort = { send: () => Promise.resolve() };

const DECISION = JSON.stringify({
  replyMessages: ["Olá!"],
  endConversation: false,
  leadIntent: "interested",
  leadQualification: "warm",
  handoffToHuman: false,
  reasoning: "x",
});
const SIGNALS = JSON.stringify({ temas: [], dores: [], modulosProvaveis: [] });

function buildUseCase(usageRecorder: UsageRecorderPort): {
  useCase: GenerateReplyUseCase;
  repo: InMemoryRepository;
} {
  const repo = new InMemoryRepository();
  const conversation = Conversation.createNew(PHONE);
  conversation.recordInboundTurn({ text: "oi", timestamp: t0, messageId: "wamid.1" });
  repo.seed(conversation);

  const llmClient = new ScriptedLlmClient([
    fakeLlmResponse(SIGNALS, { model: "claude-haiku-4-5-20251001", inputTokens: 50 }),
    fakeLlmResponse(DECISION, { model: "claude-sonnet-5", inputTokens: 900, outputTokens: 120 }),
  ]);

  const businessContextProvider = new LexicalRetrievalBusinessContext({
    llmClient,
    index: LexicalIndex.build([], {}),
    pinnedContext: "PINNED",
    extractionModel: "claude-haiku-4-5-20251001",
    topK: 4,
    minScore: 0,
    usageRecorder,
    clock: () => t0,
  });

  const useCase = new GenerateReplyUseCase({
    repository: repo,
    replyStrategy: new ReplyStrategy({
      promptText: "PROMPT",
      model: "claude-sonnet-5",
      historyTurns: 20,
    }),
    llmClient,
    replySender: NULL_SENDER,
    businessContextProvider,
    usageRecorder,
    logger,
    clock: () => t0,
    retryBackoffMs: 0,
  });

  return { useCase, repo };
}

function rows(): Array<{ call_type: string; model: string; input_tokens: number }> {
  return db
    .prepare("SELECT call_type, model, input_tokens FROM llm_usage_events ORDER BY id")
    .all() as unknown as Array<{ call_type: string; model: string; input_tokens: number }>;
}

describe("fiação do registro de consumo de LLM (integração)", () => {
  it("um turno grava duas linhas em llm_usage_events (extração + geração)", async () => {
    db = openDatabase(":memory:");
    const { useCase } = buildUseCase(new SqliteUsageRecorder(db, logger, () => t0));

    await useCase.execute(PHONE, ["wamid.1"]);

    expect(rows()).toEqual([
      { call_type: "signal-extraction", model: "claude-haiku-4-5-20251001", input_tokens: 50 },
      { call_type: "reply-generation", model: "claude-sonnet-5", input_tokens: 900 },
    ]);
  });

  it("com LLM_USAGE_TRACKING_ENABLED=false (NoopUsageRecorder) nenhuma linha é gravada", async () => {
    db = openDatabase(":memory:");
    const { useCase } = buildUseCase(new NoopUsageRecorder());

    await useCase.execute(PHONE, ["wamid.1"]);

    expect(rows()).toEqual([]);
  });
});
