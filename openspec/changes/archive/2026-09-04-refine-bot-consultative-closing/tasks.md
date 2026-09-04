## 1. Prompt de prospecção

- [x] 1.1 Reescrever a frase de abertura de `src/conversation-engine/domain/reply-strategy.prompt.md` para não tratar "demonstração" como destino equivalente a "contato com um vendedor humano" — o objetivo passa a ser conduzir a conversa sozinho até o lead manifestar intenção clara de compra.
- [x] 1.2 Na seção "Condução consultiva (discovery-first)", adicionar instrução explícita proibindo o bot de oferecer, por iniciativa própria, agendar uma demonstração/apresentação do sistema com o time.
- [x] 1.3 Adicionar instrução distinguindo pedido genérico de demo ("tem como ver funcionando?", "vocês fazem demo?") — respondido pelo próprio bot via ficha estruturada/explicação em texto — de pedido específico de atendimento humano ao vivo (call, reunião, falar com vendedor) — que segue o gatilho de handoff já existente.
- [x] 1.4 Revisar a seção "Quando transferir para um humano" para deixar explícito que oferecer/agendar demonstração não é, por si só, motivo de `handoffToHuman: true`.

## 2. Especificação

- [x] 2.1 Rodar `openspec sync-specs` (ou `/opsx:sync`) para aplicar a delta de `conversation-engine` em `openspec/specs/conversation-engine/spec.md`.

## 3. Validação manual

- [x] 3.1 Simular, no chat local ou em ambiente de teste, uma conversa em que o lead demonstra interesse maduro e verificar que o bot continua a condução consultiva em vez de oferecer demonstração/handoff.
- [x] 3.2 Simular um pedido genérico de demo ("tem como ver funcionando?") e confirmar que o bot responde com explicação/ficha estruturada sem transferir para humano.
- [x] 3.3 Simular um pedido explícito de atendimento humano ao vivo ("quero uma call com um vendedor") e confirmar que o handoff ainda ocorre normalmente.
