# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Estado atual do projeto

Este branch (`poc/oficial_api`) representa um **reinício completo** da implementação. Toda a base de código anterior (baseada em `whatsapp-web.js` e depois migrada para Baileys) foi removida (commit `project: remove old structure`). Não há código-fonte, `package.json`, nem ferramentas de build/lint/test configuradas neste momento — o repositório contém apenas o scaffolding do OpenSpec (`openspec/config.yaml`, `openspec/changes/`, `openspec/specs/`, todos vazios).

Este documento será complementado ao longo do desenvolvimento (comandos de build/lint/test, arquitetura de pastas, convenções de código) assim que essas decisões forem tomadas e implementadas. Por enquanto ele registra apenas as intenções do projeto.

## Visão do produto

Bot de WhatsApp para **prospecção de clientes**:
- Envia mensagens iniciais para potenciais clientes oferecendo produtos.
- Interpreta as respostas recebidas usando raciocínio via LLM.
- Decide dinamicamente a próxima mensagem a enviar, dando seguimento à conversa de forma contínua conforme o diálogo evolui.

## Decisões técnicas fixadas para este branch

- **Conectividade WhatsApp**: API oficial da Meta (WhatsApp Business Platform/Cloud API) — diferente dos branches anteriores, que usavam bibliotecas não oficiais (whatsapp-web.js, Baileys).
- **Runtime/linguagem**: Node.js com TypeScript.
- **Arquitetura**: Clean Architecture, Domain-Driven Design (DDD), princípios SOLID e Clean Code.
- **Processo de desenvolvimento**: Spec-Driven Development (SDD) usando o framework **OpenSpec**.

## Fluxo de trabalho com OpenSpec

O desenvolvimento é conduzido por specs antes da implementação. As skills do OpenSpec disponíveis neste projeto (via `.claude/skills` e `.agents/skills`) devem ser usadas para conduzir esse fluxo:
- `opsx:propose` / `openspec-propose` — propor uma nova change com design, specs e tasks.
- `opsx:explore` / `openspec-explore` — explorar ideias e esclarecer requisitos antes de propor uma change.
- `opsx:update` / `openspec-update-change` — revisar artefatos de uma change existente.
- `opsx:apply` / `openspec-apply-change` — implementar as tasks de uma change.
- `opsx:sync` / `openspec-sync-specs` — sincronizar delta specs para as specs principais.
- `opsx:archive` / `openspec-archive-change` — arquivar uma change concluída.

Novas funcionalidades não devem ser implementadas diretamente sem antes passar por uma change do OpenSpec (proposta em `openspec/changes/`, depois arquivada em `openspec/changes/archive/` com sincronização para `openspec/specs/`).
