import { describe, expect, it } from "vitest";
import { KnowledgeParseError, parseSalesKnowledge } from "./sales-knowledge.parser.ts";

const HAPPY = `# Título ignorado

<!-- comentário de preâmbulo -->

====
id: posicionamento
module: geral
tier: geral
kind: visao
pinned: true
title: Posicionamento

Ecossistema modular para construção civil.

====
id: gestao-obras-func
module: gestao-obras
tier: base
kind: funcionalidades

Organiza a rotina da obra e registra o trabalho de campo.
Segunda linha do corpo.

====
id: guardrails
module: geral
tier: geral
kind: guardrail

Não mencionar BIM, DWG ou IFC.
`;

describe("parseSalesKnowledge", () => {
  it("interpreta o caminho feliz com metadados e corpo", () => {
    const chunks = parseSalesKnowledge(HAPPY);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({
      id: "posicionamento",
      module: "geral",
      tier: "geral",
      kind: "visao",
      pinned: true,
      title: "Posicionamento",
    });
    expect(chunks[1]!.body).toBe(
      "Organiza a rotina da obra e registra o trabalho de campo.\nSegunda linha do corpo.",
    );
    expect(chunks[1]!.title).toBeNull();
    expect(chunks[1]!.text.startsWith("Organiza")).toBe(true);
  });

  it("marca guardrail/preco como pinned mesmo sem o metadado", () => {
    const chunks = parseSalesKnowledge(HAPPY);
    const guardrail = chunks.find((c) => c.id === "guardrails")!;
    expect(guardrail.pinned).toBe(true);

    const func = chunks.find((c) => c.id === "gestao-obras-func")!;
    expect(func.pinned).toBe(false);
  });

  it("falha quando nenhum trecho é reconhecido", () => {
    expect(() => parseSalesKnowledge("# só um título\n\nsem delimitadores")).toThrow(
      KnowledgeParseError,
    );
  });

  it("falha quando um trecho não tem os metadados obrigatórios", () => {
    const md = `====
id: sem-kind
module: geral
tier: geral

Corpo qualquer.
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/metadado obrigatório ausente: "kind"/);
  });

  it("falha quando o corpo está vazio", () => {
    const md = `====
id: vazio
module: geral
tier: geral
kind: visao
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/corpo vazio/);
  });

  it("falha em module desconhecido", () => {
    const md = `====
id: x
module: modulo-que-nao-existe
tier: base
kind: visao

Corpo.
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/module desconhecido/);
  });

  it("falha em tier incoerente com o módulo", () => {
    const md = `====
id: x
module: gestao-obras
tier: extra
kind: visao

Corpo.
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/incoerente com o módulo/);
  });

  it("falha em kind inválido", () => {
    const md = `====
id: x
module: geral
tier: geral
kind: inventado

Corpo.
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/kind inválido/);
  });

  it("falha em id duplicado", () => {
    const md = `${HAPPY}
====
id: posicionamento
module: geral
tier: geral
kind: visao

Outro corpo.
`;
    expect(() => parseSalesKnowledge(md)).toThrow(/id de trecho duplicado/);
  });
});
