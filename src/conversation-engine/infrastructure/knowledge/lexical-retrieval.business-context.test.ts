import { describe, expect, it } from "vitest";
import type {
  LlmClientPort,
  LlmRequest,
  LlmResponse,
} from "../../application/ports/llm-client.port.ts";
import { Conversation } from "../../domain/conversation.ts";
import { RETRIEVED_CONTEXT_SEPARATOR } from "../../domain/reply-strategy.ts";
import type { KnowledgeChunk } from "./knowledge.types.ts";
import { LexicalIndex } from "./lexical-index.ts";
import { LexicalRetrievalBusinessContext } from "./lexical-retrieval.business-context.ts";

function chunk(
  partial: Partial<KnowledgeChunk> & Pick<KnowledgeChunk, "id" | "body">,
): KnowledgeChunk {
  return {
    id: partial.id,
    module: partial.module ?? "geral",
    tier: partial.tier ?? "geral",
    kind: partial.kind ?? "funcionalidades",
    pinned: partial.pinned ?? false,
    title: partial.title ?? null,
    body: partial.body,
    text: partial.text ?? partial.body,
  };
}

const CHUNKS: KnowledgeChunk[] = [
  chunk({
    id: "presenca",
    module: "equipes-presenca",
    tier: "base",
    kind: "problema-solucao",
    body: "Registro diário de presença e faltas dos colaboradores em campo.",
  }),
  chunk({
    id: "dre",
    module: "dre-custos",
    tier: "base",
    kind: "problema-solucao",
    body: "Custo por obra, centros de custo, receitas e despesas.",
  }),
];

const SYNONYMS = { falta: ["equipes-presenca", "presenca"] };
const PINNED = "POSICIONAMENTO + GUARDRAILS + PLANOS";

class StubLlm implements LlmClientPort {
  calls: LlmRequest[] = [];
  constructor(private readonly next: LlmResponse | Error) {}
  generate(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    return this.next instanceof Error ? Promise.reject(this.next) : Promise.resolve(this.next);
  }
}

function provider(
  llm: LlmClientPort,
  overrides: Partial<ConstructorParameters<typeof LexicalRetrievalBusinessContext>[0]> = {},
) {
  return new LexicalRetrievalBusinessContext({
    llmClient: llm,
    index: LexicalIndex.build(CHUNKS, SYNONYMS),
    pinnedContext: PINNED,
    extractionModel: "claude-haiku-4-5-20251001",
    topK: 4,
    minScore: 0,
    synonyms: SYNONYMS,
    ...overrides,
  });
}

const conversation = Conversation.createNew("+5511999999999");

describe("LexicalRetrievalBusinessContext", () => {
  it("chamada #1 OK: usa os sinais extraídos e devolve pinned + trechos recuperados", async () => {
    const llm = new StubLlm({
      text: JSON.stringify({
        temas: ["presença"],
        dores: ["controle de faltas"],
        modulosProvaveis: ["equipes-presenca"],
      }),
    });
    const p = provider(llm);

    const context = await p.getContext({ conversation, newMessages: ["preciso de ajuda"] });

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]!.model).toBe("claude-haiku-4-5-20251001");
    expect(context.startsWith(PINNED)).toBe(true);
    expect(context).toContain(RETRIEVED_CONTEXT_SEPARATOR);
    expect(context).toContain("Registro diário de presença");
  });

  it("chamada #1 falha: cai para extração local e ainda recupera trechos", async () => {
    const llm = new StubLlm(new Error("timeout na extração"));
    const p = provider(llm);

    const context = await p.getContext({
      conversation,
      newMessages: ["tenho problema para controlar faltas"],
    });

    expect(context.startsWith(PINNED)).toBe(true);
    expect(context).toContain(RETRIEVED_CONTEXT_SEPARATOR);
    expect(context).toContain("presença e faltas");
  });

  it("chamada #1 vazia: cai para extração local", async () => {
    const llm = new StubLlm({
      text: JSON.stringify({ temas: [], dores: [], modulosProvaveis: [] }),
    });
    const p = provider(llm);

    const context = await p.getContext({
      conversation,
      newMessages: ["controlar faltas da equipe"],
    });

    expect(context).toContain(RETRIEVED_CONTEXT_SEPARATOR);
    expect(context).toContain("presença e faltas");
  });

  it("busca sem resultado: devolve só o conjunto pinned (sem separador)", async () => {
    const llm = new StubLlm({
      text: JSON.stringify({ temas: [], dores: [], modulosProvaveis: [] }),
    });
    const p = provider(llm);

    const context = await p.getContext({ conversation, newMessages: ["oi tudo bem"] });

    expect(context).toBe(PINNED);
    expect(context).not.toContain(RETRIEVED_CONTEXT_SEPARATOR);
  });

  it("pinned está sempre presente, mesmo com a extração falhando e a busca vazia", async () => {
    const llm = new StubLlm(new Error("falhou"));
    const p = provider(llm);

    const context = await p.getContext({ conversation, newMessages: ["xyzzy plugh"] });

    expect(context).toBe(PINNED);
  });

  it("a chamada de extração NÃO pede intenção/qualificação e usa schema estruturado", async () => {
    const llm = new StubLlm({
      text: JSON.stringify({ temas: [], dores: [], modulosProvaveis: [] }),
    });
    const p = provider(llm);
    await p.getContext({ conversation, newMessages: ["oi"] });

    const call = llm.calls[0]!;
    const systemText =
      typeof call.system === "string" ? call.system : call.system.map((b) => b.text).join("\n");
    expect(systemText).toMatch(/NÃO classifique/i);
    expect(call.responseSchema).toBeDefined();
    const schemaKeys = Object.keys(
      (call.responseSchema as { properties: Record<string, unknown> }).properties,
    );
    expect(schemaKeys).toEqual(["temas", "dores", "modulosProvaveis"]);
  });
});
