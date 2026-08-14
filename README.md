# WhatsApp Lead Prospector Bot

Plataforma de prospecção ativa (*outbound*) via WhatsApp: dispara mensagens personalizadas para listas de leads, qualifica o interesse por conversa com IA e transfere leads qualificados para SDRs. Veja o PRD completo em [`specs/prd.md`](specs/prd.md).

## Status do projeto

Estágio inicial. As decisões de arquitetura da camada de conectividade WhatsApp e do motor anti-ban/warmup estão formalizadas e implementadas — ver [`openspec/changes/define-whatsapp-connection-strategy/`](openspec/changes/define-whatsapp-connection-strategy). As peças abaixo existem e têm cobertura de teste, mas **ainda não estão conectadas num pipeline único** — `src/index.ts` é hoje só um placeholder.

Pendências conhecidas:
- Orquestração end-to-end (ligar fila de envio → rampa de aquecimento por número → sessão) ainda não foi implementada.
- Pareamento real via QR code (task 4.1 do change acima) requer verificação manual com um celular físico — ainda não confirmado.
- `npm audit` reporta vulnerabilidades de severidade alta herdadas da árvore de dependências do `whatsapp-web.js`/Puppeteer.

## Decisões-chave

| Decisão | Valor | Detalhes |
| :--- | :--- | :--- |
| Conectividade WhatsApp | `whatsapp-web.js` (não-oficial, via QR code) | [design.md](openspec/changes/define-whatsapp-connection-strategy/design.md) |
| Meta de volume | 100 disparos/dia (definitiva, não é meta de MVP) | [proposal.md](openspec/changes/define-whatsapp-connection-strategy/proposal.md) |
| Linguagem | TypeScript (Node.js) | — |

## Stack técnica

- **Runtime:** Node.js 20+ (desenvolvido e testado com Node 24)
- **Linguagem:** TypeScript
- **Conexão WhatsApp:** [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js) (Puppeteer por baixo dos panos)
- **Testes:** runner nativo do Node (`node:test`)

## Como rodar

```bash
npm install          # instala dependências

npm run dev           # roda src/index.ts direto via ts-node
npm run build          # compila TypeScript para dist/
npm start               # roda a build compilada (dist/index.js)
npm test                # compila e roda a suíte de testes automatizados
```

O primeiro pareamento de um número WhatsApp exibe um QR code no terminal para ser escaneado pelo app do celular. As credenciais da sessão ficam persistidas em `.wwebjs_auth/` (não versionado) para não exigir novo QR code a cada reinício.

## Estrutura do projeto

```
src/
├── index.ts                        # entry point (placeholder — orquestração ainda não implementada)
├── whatsapp/
│   ├── session.ts                  # sessão individual: pareamento, reconexão, presença
│   └── sessionManager.ts           # limite de sessões simultâneas
├── warmup/
│   ├── warmupSchedule.ts           # cálculo da rampa de aquecimento por número
│   └── warmupTracker.ts            # persiste a data de ativação de cada número
└── outbound/
    ├── sendQueue.ts                # fila de envio com atraso aleatório (jitter)
    └── dailyVolumeLimiter.ts       # teto diário agregado (100 disparos/dia)

specs/prd.md                        # PRD do produto
openspec/                           # propostas, specs e design das mudanças arquiteturais
```

## Fluxo do motor anti-ban/warmup

```
WarmupSchedule + WarmupTracker  →  SendQueue (jitter)  →  DailyVolumeLimiter  →  WhatsAppSession (presença)
"quanto esse número            "envia um por vez,       "a plataforma já       "digitando..." antes
pode mandar hoje?"              com atraso variável"      bateu 100/dia?"        de enviar de fato
```

Cada peça tem testes automatizados próprios (`npm test`). Detalhes de cada requisito em [`openspec/changes/define-whatsapp-connection-strategy/specs/`](openspec/changes/define-whatsapp-connection-strategy/specs/).

## Workflow OpenSpec

Este projeto usa [OpenSpec](openspec/config.yaml) para propor, especificar e implementar mudanças de forma rastreável. Mudanças em andamento ficam em `openspec/changes/<nome-da-mudança>/` (proposal, design, specs, tasks); ao serem concluídas, são arquivadas e suas specs viram a fonte de verdade em `openspec/specs/`.
