## 1. Setup do Projeto

- [x] 1.1 Inicializar projeto Node.js com TypeScript (package.json, tsconfig.json, estrutura `src/`)
- [x] 1.2 Adicionar dependência `whatsapp-web.js` e suas peer dependencies (Puppeteer)

## 2. Conectividade WhatsApp (whatsapp-connectivity)

- [x] 2.1 Implementar gerenciador de sessão: criação de um `Client` whatsapp-web.js com pareamento via QR code
- [x] 2.2 Persistir credenciais de sessão (estratégia `LocalAuth`) para não exigir novo QR code a cada reinício
- [x] 2.3 Implementar reconexão automática em caso de desconexão inesperada da sessão
- [x] 2.4 Limitar/configurar o número máximo de sessões simultâneas suportadas

## 3. Motor Anti-Ban / Aquecimento (anti-ban-warmup)

- [x] 3.1 Implementar rampa de aquecimento por número (volume permitido cresce gradualmente desde o pareamento até o alotamento pleno)
- [x] 3.2 Implementar fila de envio com atraso randomizado (jitter) entre mensagens consecutivas
- [x] 3.3 Implementar simulação de presença (indicador "digitando" antes do envio; marcar mensagens recebidas como lidas)
- [x] 3.4 Implementar teto diário de envio agregado por toda a plataforma (100 disparos/dia), adiando o excedente para o dia seguinte

## 4. Verificação

- [ ] 4.1 Testar pareamento de um número via QR code e confirmar que a sessão persiste após reinício do processo
  - [x] Cobertura automatizada da lógica de sessão (transições de estado, reconexão, presença) via `src/whatsapp/session.test.ts` com um Client falso
  - [ ] Pareamento real com QR code + confirmação de persistência após restart — requer um celular físico; pendente de QA manual. Marcar 4.1 como concluída somente após essa verificação.
- [x] 4.2 Testar que a rampa de aquecimento e o teto diário são respeitados (com configuração acelerada para teste)
