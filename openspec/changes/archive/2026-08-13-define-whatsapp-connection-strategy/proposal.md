## Why

O PRD deixava a conectividade WhatsApp em aberto ("Cloud API ou multissessão") e definia uma meta de escala de 50.000 disparos/dia sem resolver os riscos operacionais reais de cada caminho. A exploração mostrou que (a) o modelo de prospecção fria por lista entra em tensão com a política de opt-in da Meta em qualquer um dos dois canais, e (b) o motor de anti-ban/warmup é, na prática, o núcleo diferenciador do produto, não um detalhe técnico. A decisão de adotar conectividade não-oficial via whatsapp-web.js e reduzir a meta definitiva para 100 disparos/dia precisa ser formalizada para destravar o design técnico do motor de mensageria.

## What Changes

- Adotar **whatsapp-web.js** (automação do WhatsApp Web via Puppeteer) como camada de conectividade WhatsApp, substituindo a opção de Cloud API considerada na RNF "Integração WhatsApp API" do PRD.
- Fixar a meta definitiva de volume de disparo em **100 disparos/dia** (não é meta de MVP — é o alvo final do produto). **BREAKING** em relação à RNF "Escalabilidade" do PRD (que citava 50.000 disparos/dia) e à leitura de "escala" implícita no objetivo de negócio 2.1.
- Definir um motor de aquecimento/throttling (anti-ban) dimensionado para esse volume: rampa gradual de aquecimento por número, cadência com jitter, simulação de presença (digitando/online/lido) — substituindo o escopo genérico de RF-06 por regras concretas e testáveis.
- Descopar explicitamente do v1: rotação entre múltiplos números como mecanismo central e proxy dedicado por sessão — a operação é dimensionada para 1 a poucos números simultâneos.

## Capabilities

### New Capabilities
- `whatsapp-connectivity`: como a plataforma conecta e mantém sessões WhatsApp ativas (biblioteca whatsapp-web.js, modelo de sessão única/poucas sessões, pareamento via QR code).
- `anti-ban-warmup`: regras de aquecimento e throttling que limitam o volume de envio por número para operar com segurança dentro da meta de 100 disparos/dia.

### Modified Capabilities
_Nenhuma — `openspec/specs/` ainda está vazio; este é o primeiro change a formalizar capacidades do produto no OpenSpec._

## Impact

- **specs/prd.md** (documento livre, fora do OpenSpec): a RNF "Integração WhatsApp API" (linha 72) e a RNF "Escalabilidade" (linha 70) descrevem a meta de 50.000 disparos/dia e a opção "Cloud API ou multissessão" que este change substitui. Ficam desalinhadas até serem atualizadas manualmente — fora do escopo deste change, sinalizado aqui para rastreabilidade.
- RF-06 (Anti-Ban / Warmup) do PRD passa a ser coberto de forma concreta pela capability `anti-ban-warmup`.
- Nenhum código existe ainda no projeto — este change não impacta implementação, apenas fixa a base para o design técnico do motor de mensageria.
