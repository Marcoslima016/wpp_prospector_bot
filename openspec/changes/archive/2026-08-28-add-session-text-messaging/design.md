## Context

Ver `proposal.md` — Why. Estado atual: `WhatsAppGatewayPort` expõe só `sendTemplateMessage`; `MetaCloudApiGateway` implementa esse único método via `POST /{phoneNumberId}/messages` com corpo `type: "template"`, tratando erro/`wamid` inline. Existem os VOs `OutboundMessage` (template) e `InboundMessage`, cada um com schema zod próprio e factory `create`. O composition root em `main.ts` é manual e já exporta `SendOutboundMessageUseCase` para QA.

## Goals / Non-Goals

**Goals:**
- Adicionar o caminho de envio de texto livre reaproveitando a infraestrutura de transporte já existente (mesma URL, credenciais, versão de Graph API, mapeamento de erro).
- Manter a simetria com o padrão já estabelecido (VO próprio + factory zod + use case fino + método no gateway).

**Non-Goals:**
- Rastrear ou validar a janela de atendimento de 24h (sem estado de "última mensagem do lead" nesta change).
- Dividir, truncar ou reformatar textos que excedam 4096 caracteres — quem gera o texto (change `add-conversation-engine`) trata isso.
- Expor gatilho HTTP para envio.

## Decisions

**Novo método `sendTextMessage` no mesmo `WhatsAppGatewayPort`, não um port separado.** Mesmo endpoint, mesmo retorno (`SentMessage { wamid }`), mesma família de falhas (`WhatsAppApiError`). Um port separado fragmentaria sem ganho de desacoplamento. Alternativa considerada: generalizar para `sendMessage(payload)` com union type template|texto — rejeitada porque esconde que os payloads da Cloud API são estruturalmente diferentes e obrigaria os dois casos a carregar campos irrelevantes.

**VO `OutboundTextMessage` separado de `OutboundMessage`, não campos opcionais num VO único.** Invariantes distintas: template exige `templateName` + `languageCode` + `parameters`; texto exige apenas `body` (1–4096 chars) + `to` (E.164). Espelha a separação já existente entre `OutboundMessage` e `InboundMessage`. Um VO único com campos opcionais tornaria as invariantes não-expressáveis no schema.

**Janela de 24h não é verificada pelo sistema.** O sistema não persiste quando o lead falou pela última vez nesta change, então não há como validar a janela localmente sem estado frágil. A Cloud API rejeita o envio fora da janela e o erro é propagado pelo mesmo caminho `WhatsAppApiError` já usado para template.

**Extrair helper privado no `MetaCloudApiGateway` para parse de resposta.** O tratamento de `response.ok`, extração de `wamid` e construção de `WhatsAppApiError` a partir do corpo de erro é idêntico entre template e texto. Extrair um método privado compartilhado evita divergência entre os dois caminhos.

**Sem gatilho HTTP; export no `main.ts` para QA manual.** Espelha o tratamento de `SendOutboundMessageUseCase`. O consumidor real (`add-conversation-engine`) injeta `SendTextMessageUseCase` via composition root através de um port de envio próprio.

## Risks / Trade-offs

- **Janela fechada só é descoberta no momento do envio** → o erro é propagado e cabe ao chamador (change `add-conversation-engine`) logar/retry. Nesta change não há chamador automático, então o risco é nulo até a próxima change.
- **Texto do LLM pode exceder 4096 caracteres** → a validação de domínio rejeita antes da API com erro identificável; a change `add-conversation-engine` precisa lidar com divisão/truncamento antes de chamar este use case. Fora do escopo aqui.
- **Helper compartilhado no gateway acopla os dois caminhos de envio** → se a Cloud API divergir o formato de resposta entre template e texto (não é o caso hoje), o helper precisa ser parametrizado ou desmembrado.
