## Why

O bot hoje só sabe abrir sessão via QR code e enviar/receber mensagens no nível de transporte — não existe nenhuma lógica que entenda o conteúdo de uma mensagem recebida e decida o que responder. Sem isso, o RF-03 (motor de conversa com suporte a LLM) e o RF-04 (classificação de intenção do lead) do PRD não têm nenhuma implementação, e o bot não consegue conduzir uma qualificação real de leads.

## What Changes

- `WhatsAppSession` passa a emitir um evento para mensagens 1:1 recebidas (excluindo grupos e mensagens `fromMe`), hoje só consumidas internamente para marcar como lida.
- Novo caso de uso que, ao receber uma mensagem: carrega o histórico da conversa, chama a camada de raciocínio (LLM) com esse histórico, recebe de volta o texto de resposta e a intenção classificada do lead, persiste o novo turno da conversa, e enfileira a resposta através do pipeline de envio já existente (`SendQueue` + gates de warmup/volume) em vez de enviar diretamente.
- Nova interface `ReasoningRepository`, que abstrai a chamada a um provedor de LLM para gerar `{ replyText, intent }` a partir do histórico da conversa — implementada inicialmente por uma classe que usa a API da Anthropic (Claude), permitindo no futuro outra implementação para outro provedor sem alterar o caso de uso.
- Nova interface `ConversationRepository`, que abstrai a persistência do histórico de conversa por lead — implementada inicialmente em arquivo local, seguindo o mesmo padrão já usado por `WarmupTracker`/`DailyVolumeLimiter`.
- `intent` classificada cobre os 4 valores do RF-04 (Interessado / Sem Interesse / Dúvida / Opt-out). Nesta versão a intenção é apenas classificada e persistida — nenhuma ação automática (ex.: bloqueio de opt-out, notificação de handoff) é disparada a partir dela; isso fica para changes futuros dedicados ao RF-05/RF-07.
- System prompt e nome do modelo Claude passam a vir de um único arquivo de configuração externo ao código, em vez de hardcoded.
- Nova dependência: SDK oficial da Anthropic. Nova variável de ambiente para a API key.

## Capabilities

### New Capabilities
- `conversation-reasoning`: o bot entende mensagens recebidas via LLM, mantém histórico de conversa por lead, gera respostas contextuais e classifica a intenção do lead, entregando a resposta pelo pipeline de envio existente.

### Modified Capabilities
(nenhuma — a captura/exposição da mensagem recebida é tratada como comportamento observável da nova capability `conversation-reasoning`, não como uma mudança nos requisitos já existentes de `whatsapp-connectivity`, que trata de pareamento/reconexão/escala da sessão)

## Impact

- **Código afetado**: `src/whatsapp/session.ts` (novo evento de mensagem recebida), `src/index.ts` (wiring do novo caso de uso), novo diretório `src/reasoning/` (`domain/`, `application/`, `infrastructure/`).
- **Dependências novas**: SDK oficial da Anthropic (`@anthropic-ai/sdk` ou equivalente).
- **Configuração nova**: variável de ambiente para a API key da Anthropic; arquivo de configuração externo com system prompt + nome do modelo.
- **Armazenamento novo**: arquivos locais de histórico de conversa por lead, seguindo a convenção de persistência local já usada no projeto (`.baileys_auth/`).
- **Sem impacto** em `warmup/`, `outbound/` (SendQueue e gates existentes são reaproveitados sem alteração de contrato) nem nos requisitos já publicados de `whatsapp-connectivity`/`anti-ban-warmup`.
