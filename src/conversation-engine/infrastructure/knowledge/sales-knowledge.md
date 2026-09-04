# Base de conhecimento comercial — Obra na Mão / FluxoDRE

<!--
Fonte curada e deduplicada de docs/payloads/*.txt. ESTA é a fonte de verdade em
runtime; os payloads são histórico. Para alterar o que o bot sabe: editar este
arquivo (e pricing.md) e reiniciar o processo.

Formato: cada trecho começa numa linha de "====", seguida por linhas de
metadados "chave: valor" e uma linha em branco, depois o corpo do trecho até o
próximo "====". Metadados obrigatórios: id, module, tier, kind.
  module  → id do catálogo (src/conversation-engine/domain/product-catalog.ts) ou "geral"
  tier    → base | extra | geral
  kind    → visao | funcionalidades | problema-solucao | publico | guardrail | objecao | discovery | preco
  pinned  → true para entrar SEMPRE no contexto (guardrails/preço/posicionamento). Opcional; default false.
Trechos com kind guardrail ou preco são pinned automaticamente.
-->

====
id: posicionamento
module: geral
tier: geral
kind: visao
pinned: true
title: Posicionamento do produto

O Obra na Mão / FluxoDRE é um ecossistema modular de gestão para empresas da
construção civil. Ele conecta operação de campo, equipes, planejamento,
administração, financeiro inteligente e capacitação numa estrutura integrada,
aproximando a realidade da obra das informações usadas pelo escritório.

Não é "um aplicativo para controlar obras", nem apenas um ERP, um app de ponto,
um gerenciador de tarefas, um sistema financeiro ou uma plataforma de
treinamento. É um ecossistema que reúne essas camadas.

Explicação curta (quando o lead só pergunta "o que o sistema faz?"): o Obra na
Mão conecta a operação da obra com o escritório, organizando equipes, presença,
tarefas, frentes de serviço, pavimentos, planejamento, pendências, documentos e
informações administrativas e financeiras, com análise financeira inteligente e
uma Universidade Empresarial para capacitação.

Explicação intermediária (quando pede mais detalhes): a plataforma tem módulos
por área. No campo, encarregados e equipes acompanham tarefas, frentes,
pavimentos, presença e planejamento. No escritório, a gestão organiza
colaboradores, documentos, registros administrativos, custos e DRE. O módulo
financeiro inteligente ajuda a conferir extratos e pagamentos, inclusive quando
uma transferência representa várias obrigações. Há ainda a Universidade
Empresarial para capacitação dos colaboradores.

====
id: guardrails-produto
module: geral
tier: geral
kind: guardrail
title: Guardrails de produto e fidelidade à base

O bot NÃO deve:
- inventar funcionalidades, números, prazos, garantias ou condições comerciais;
- apresentar recursos em desenvolvimento como se já estivessem disponíveis;
- prometer integrações não confirmadas;
- prometer economia financeira específica (percentual ou valor) sem análise do time;
- afirmar que uma automação elimina a conferência humana;
- dizer que a inteligência artificial toma decisões financeiras de forma autônoma —
  sempre diferenciar automação de apoio da decisão final do usuário;
- mencionar BIM, CompatibilizaBIM, DWG ou IFC como parte da oferta atual;
- tratar todos os usuários como administradores.

Quando a informação não constar na base: dizer que vai confirmar com o time, sem
inventar a resposta.

====
id: guardrail-venda-modular
module: geral
tier: geral
kind: guardrail
title: Regras de venda modular

- Não apresentar todos os módulos automaticamente; primeiro entender a necessidade.
- Apresentar apenas o conjunto mínimo de módulos relacionado à dor identificada.
- Nunca afirmar que todos os módulos são obrigatórios ou precisam ser usados juntos.
- Quando uma funcionalidade funciona melhor integrada a outro módulo, apresentar a
  integração como benefício adicional, nunca como obrigação.
- Não inventar dependências técnicas entre módulos.
- Os módulos do conjunto adicional (Artisys Finance, Universidade Empresarial,
  Jogos e Gamificação, Assistente Inteligente) NÃO são contratáveis avulsos: só
  entram pelo plano Personalizado, que libera todos eles.

====
id: guardrail-fora-segmento
module: geral
tier: geral
kind: guardrail
title: Lead fora do segmento de construção civil

Quando ficar claro que o lead não atua com execução de obras / construção civil,
encerrar de forma cordial e qualificar o lead como frio (`cold`), sem forçar a
oferta.

====
id: venda-consultiva
module: geral
tier: geral
kind: discovery
title: Como conduzir a venda (consultiva)

Antes de apresentar módulos, identificar a necessidade ou dor do lead com
perguntas de sondagem objetivas — uma pergunta por mensagem. Identificada a dor,
apresentar apenas o conjunto mínimo de módulos relacionado a ela e enquadrar a
oferta nos planos Essencial e Personalizado, sem afirmar que o lead precisa de
todos os módulos.

Formato do canal (WhatsApp): mensagens curtas, explicação curta ou intermediária.
A ficha estruturada de um módulo só quando o lead pedir detalhes daquele módulo
explicitamente.

Lógica comercial: não vender obrigatoriamente um sistema grande para todos;
identificar a dor, selecionar o módulo adequado, resolver aquela necessidade e
permitir integração com outras áreas quando fizer sentido.

====
id: ficha-modulo-formato
module: geral
tier: geral
kind: discovery
title: Formato da ficha estruturada de um módulo

Quando o lead pedir os detalhes de um módulo específico, responder no modo
estruturado (ver "Formato das respostas" no prompt), seguindo este molde:

```
*<emoji> <Nome do módulo>*

_O que é:_ <descrição curta>

_Para quem é:_ <perfil de empresa ou usuário>

_Resolve principalmente:_ <principais dores>

*Funcionalidades:*
▪ <funcionalidade mais relevante>
▪ <funcionalidade mais relevante>
▪ <funcionalidade mais relevante>

✅ <"Funciona separado, sem depender de outros módulos." ou a dependência,
   se houver>
🔗 Integra com: <módulos relacionados>
```

Escolha um emoji que represente o módulo (ex.: 📦 para gestão de obras, 🧱
para acompanhamento de obra). Liste só as funcionalidades mais relevantes
para a dor do lead, não a lista inteira do trecho de funcionalidades.

====
id: discovery-perguntas
module: geral
tier: geral
kind: discovery
title: Banco de perguntas de sondagem

- Quantas obras vocês administram ao mesmo tempo?
- Quantas pessoas trabalham em campo? Existe encarregado responsável pelas equipes?
- Como vocês controlam presença e faltas hoje?
- Como fazem o planejamento das atividades? Trabalham com serviços repetitivos por pavimento?
- Usam planilhas para acompanhar as obras? Como as informações chegam da obra até o escritório?
- Como controlam documentos e pagamentos dos funcionários? Conseguem separar custos por obra?
- Como fazem a conferência dos pagamentos com o extrato bancário?
- Existe necessidade de treinamento ou capacitação da equipe?

====
id: publico-alvo
module: geral
tier: geral
kind: publico
title: Perfis de empresa que se beneficiam

Empresas que executam obras e têm equipes distribuídas entre campo e escritório:
empreiteiras, subempreiteiras, empresas de instalações, hidráulicas, elétricas,
prestadores de serviços especializados, empresas que atuam em obras verticais,
construtoras e operações que administram ao mesmo tempo equipe, obra e custos.

O produto não se limita a empresas hidráulicas: a gestão de frentes, equipes,
tarefas, obras e financeiro se aplica a diferentes segmentos da construção.

====
id: dores-gerais
module: geral
tier: geral
kind: problema-solucao
title: Principais dores que o ecossistema resolve

- gestão baseada em planilhas separadas e excesso de controles manuais;
- informações espalhadas em grupos de WhatsApp, papéis e controles pessoais;
- dificuldade de saber o que está acontecendo nas obras e de acompanhar equipes;
- dificuldade de controlar frentes por pavimento;
- retrabalho administrativo e documentos espalhados;
- pouca integração entre obra e escritório;
- dificuldade para relacionar despesas às obras e para conferir pagamentos e extratos;
- falta de histórico operacional;
- dependência excessiva do conhecimento de uma única pessoa;
- dificuldade de capacitar equipes de campo.

====
id: gestao-obras-funcionalidades
module: gestao-obras
tier: base
kind: funcionalidades
title: Gestão de Obras / Obra na Mão Campo — o que é e funcionalidades

Núcleo operacional para organizar a rotina dentro das obras e registrar o
trabalho de campo de forma estruturada. Transforma o planejamento em atividades
acompanhadas diariamente pela administração e pela equipe.

Funcionalidades:
- cadastro de obras e vínculo de equipes
- organização do dia de trabalho
- acompanhamento de atividades e tarefas
- frentes de serviço
- registros por data e observações operacionais
- consulta de dias anteriores e planejamento de dias futuros
- acompanhamento de pavimentos
- registro de pendências
- uso por administrador, encarregado e colaborador

Pensado para uso no celular, em campo.

Pode ser vendido separadamente. Integra depois com gestão administrativa,
colaboradores, financeiro, DRE, Universidade Empresarial e dashboards.

====
id: gestao-obras-dores
module: gestao-obras
tier: base
kind: problema-solucao
title: Gestão de Obras — dores que resolve

Para quem tem informação espalhada em grupos de WhatsApp, não sabe o que está
acontecendo em cada obra, não tem registro das atividades executadas, depende
demais do encarregado, planeja só verbalmente, tem dificuldade de acompanhar
equipes ou não tem histórico do dia a dia da obra.

Frases típicas do cliente: "o encarregado me manda tudo pelo WhatsApp", "não sei
o que cada equipe está fazendo", "não tenho histórico do que aconteceu na obra".

====
id: obra360-funcionalidades
module: obra360
tier: base
kind: funcionalidades
title: Obra360 — o que é e funcionalidades

Camada de acompanhamento que consolida a visão operacional da obra de forma
rápida.

Áreas:
- Dia — execução imediata
- Pavimentos — evolução dos serviços por pavimento, útil em obras verticais
- Planejamento — o que está previsto para os próximos períodos
- Pendências — o que impede a continuidade do trabalho: frente não liberada,
  serviço anterior pendente, correção, dependência de outra equipe, material
  pendente

Funciona melhor conectado aos dados de Gestão de Obras.

====
id: obra360-dores
module: obra360
tier: base
kind: problema-solucao
title: Obra360 — dores que resolve

Para quem não consegue acompanhar em qual pavimento cada equipe está, tem várias
equipes em vários andares, perde pendências importantes na memória do encarregado
ou não tem uma visão consolidada do andamento da obra.

Frases típicas: "não consigo acompanhar em qual pavimento cada equipe está",
"tenho várias equipes em vários andares", "não sei o que minhas equipes estão
fazendo".

====
id: equipes-presenca-funcionalidades
module: equipes-presenca
tier: base
kind: funcionalidades
title: Gestão de Equipes e Presença — o que é e funcionalidades

Organiza os colaboradores das obras e o acompanhamento de presença e atuação em
campo.

Funcionalidades:
- cadastro de colaboradores e vínculo às obras
- associação a tarefas e frentes
- registro diário de presença e de faltas
- histórico de registros
- identificação de quem estava disponível em determinado dia
- perfis de acesso (administrador, encarregado, colaborador)

Pode ser vendido separadamente, como solução inicial para quem precisa organizar
equipes e presença antes de implantar funcionalidades mais amplas.

====
id: equipes-presenca-dores
module: equipes-presenca
tier: base
kind: problema-solucao
title: Gestão de Equipes e Presença — dores que resolve

Para quem tem problema para controlar faltas, reconstrói presença depois usando
conversas e anotações em papel, mantém controles paralelos de equipe ou não
consegue saber quem trabalhou em cada dia.

Frases típicas: "tenho problema para controlar faltas", "meu encarregado manda a
lista de presença por WhatsApp".

====
id: planejamento-frentes-funcionalidades
module: planejamento-frentes
tier: base
kind: funcionalidades
title: Planejamento e Frentes de Serviço — o que é e funcionalidades

Organiza onde cada equipe trabalha, qual atividade executa e como os serviços
avançam ao longo da obra.

Funcionalidades:
- criação e controle de frentes
- definição de atividade, colaboradores e local ou pavimento
- continuidade de frentes (uma frente permanece ativa por vários dias, sem
  recriar todo dia)
- planejamento diário, semanal e futuro
- acompanhamento da progressão do serviço, inclusive pavimento a pavimento em
  obras verticais
- observações e pendências por frente
- histórico de execução

Pode ser vendido separadamente, indicado para quem já tem controles
administrativos mas tem dificuldade no planejamento da produção em campo.

====
id: planejamento-frentes-dores
module: planejamento-frentes
tier: base
kind: problema-solucao
title: Planejamento e Frentes — dores que resolve

Para quem tem várias equipes ou serviços simultâneos, não sabe qual frente está
em qual pavimento, planeja a produção só verbalmente ou perde a continuidade de
serviços que duram vários dias.

Frases típicas: "tenho várias equipes em vários andares", "não consigo acompanhar
em qual pavimento cada equipe está".

====
id: checklists-funcionalidades
module: checklists
tier: base
kind: funcionalidades
title: Checklists e Controle Operacional — o que é e funcionalidades

Padroniza verificações recorrentes da empresa para que atividades importantes não
dependam só da memória dos responsáveis.

Funcionalidades:
- criação e administração de checklists e seus itens
- uso em rotinas operacionais
- acompanhamento de verificações
- associação a atividades ou ao contexto da obra
- histórico de registros

Exemplos: início de atividade, conferência de preparação, fechamento do dia,
validação de etapas, rotinas e verificações administrativas.

Pode ser vendido separadamente, para quem quer começar pela padronização de
processos.

====
id: checklists-dores
module: checklists
tier: base
kind: problema-solucao
title: Checklists — dores que resolve

Para quem precisa padronizar as verificações da obra, garante etapas só "de
cabeça", esquece conferências no início ou no fechamento do dia ou quer processos
repetíveis entre obras.

Frases típicas: "preciso padronizar as verificações da obra", "cada encarregado
faz de um jeito".

====
id: fluxodre-desktop-funcionalidades
module: fluxodre-desktop
tier: base
kind: funcionalidades
title: FluxoDRE Desktop / Gestão Administrativa — o que é e funcionalidades

Camada administrativa do ecossistema, em ambiente desktop, para o escritório.

Funcionalidades:
- cadastro de colaboradores
- organização de documentos
- registros administrativos
- vales, pagamentos, recibos e obrigações
- obras e centros de custo
- informações financeiras e DRE
- dashboards, relatórios e histórico
- geração e organização de documentos administrativos, reduzindo digitação
  repetida

Indicado para operações com maior volume de informação, análise detalhada,
organização documental e uso recorrente no escritório. Pode ser vendido
separadamente, mesmo sem o módulo de campo.

====
id: fluxodre-desktop-dores
module: fluxodre-desktop
tier: base
kind: problema-solucao
title: FluxoDRE Desktop — dores que resolve

Para quem usa muitas planilhas no escritório, tem retrabalho administrativo,
documentos espalhados pelo computador e pouca organização de cadastros,
pagamentos e obrigações.

Frases típicas: "uso muitas planilhas no escritório", "tenho várias planilhas de
funcionários e documentos".

====
id: colaboradores-documentos-funcionalidades
module: colaboradores-documentos
tier: base
kind: funcionalidades
title: Gestão de Colaboradores e Documentos — o que é e funcionalidades

Centraliza dados dos colaboradores e documentos associados.

Funcionalidades:
- cadastro e organização de dados cadastrais
- associação com obras e com registros financeiros
- documentos e anexos por colaborador
- histórico
- reaproveitamento dos mesmos dados em diferentes partes do sistema

O colaborador passa a ser uma entidade única, sem recadastro em cada controle.

Pode ser vendido separadamente, como solução de organização administrativa e de
pessoal.

====
id: colaboradores-documentos-dores
module: colaboradores-documentos
tier: base
kind: problema-solucao
title: Colaboradores e Documentos — dores que resolve

Para quem controla funcionários por planilhas, arquivos locais ou pastas físicas,
recadastra a mesma pessoa em vários lugares e perde documentos espalhados.

Frases típicas: "tenho várias planilhas de funcionários e documentos", "os
documentos ficam espalhados em pastas no computador".

====
id: vales-pagamentos-funcionalidades
module: vales-pagamentos
tier: base
kind: funcionalidades
title: Vales, Pagamentos e Obrigações — o que é e funcionalidades

Organiza obrigações financeiras ligadas aos colaboradores e à operação.

Funcionalidades:
- registro de vales, pagamentos e recibos
- obrigações previstas
- associação de registros a colaboradores e a obra ou centro de custo
- histórico financeiro
- preparação dos dados para análise financeira

Os registros servem depois de base para a conciliação financeira — comparar o que
a empresa esperava pagar com o que efetivamente saiu da conta. Pode ser vendido
separadamente ou junto com Artisys Finance para uma solução financeira completa.

====
id: dre-custos-funcionalidades
module: dre-custos
tier: base
kind: funcionalidades
title: DRE, Custos e Centros de Custo — o que é e funcionalidades

Dá ao gestor uma visão organizada de receitas, despesas, custos e resultado.

Funcionalidades:
- organização de receitas e despesas
- estrutura de DRE
- análise e classificação de custos
- centros de custo
- associação de gastos a obras
- consolidação financeira
- dashboards e indicadores

Centros de custo permitem relacionar cada gasto ao contexto em que ocorreu (obra,
atividade, setor, categoria), evoluindo de uma visão financeira geral para uma
visão ligada à execução: entender não só quanto a empresa gastou, mas onde.

Pode ser vendido separadamente, para quem precisa melhorar a gestão financeira e
a leitura do resultado.

====
id: dre-custos-dores
module: dre-custos
tier: base
kind: problema-solucao
title: DRE e Centros de Custo — dores que resolve

Para quem tem dificuldade para saber quanto cada obra custa, não separa custos
por obra, não enxerga o resultado da operação ou só tem uma visão financeira
genérica.

Frases típicas: "tenho dificuldade para saber quanto cada obra custa", "não sei
qual obra dá lucro".

====
id: hub-funcionalidades
module: hub
tier: base
kind: funcionalidades
title: Hub Obra na Mão — o que é e funcionalidades

Porta de entrada do ecossistema: organiza o acesso aos módulos contratados
conforme o perfil do usuário.

Funcionalidades:
- acesso centralizado
- organização dos módulos
- identificação do usuário e perfil de acesso
- direcionamento para as ferramentas contratadas
- experiência integrada entre sistemas

Faz mais sentido quando a empresa usa mais de um módulo.

====
id: artisys-finance-funcionalidades
module: artisys-finance
tier: extra
kind: funcionalidades
title: Artisys Finance (Financeiro Inteligente) — o que é e funcionalidades

Camada de inteligência financeira sobre o FluxoDRE: confere movimentações e
compara o extrato bancário com obrigações e registros existentes.

Funcionalidades:
- leitura de documentos financeiros, extratos e PDFs bancários
- identificação de movimentações
- comparação com obrigações
- conciliação financeira
- sugestão de correspondências
- detecção de divergências
- análise de pagamentos
- identificação de casos que exigem revisão humana

Concilia inclusive quando um único pagamento representa várias obrigações
(ex.: um PIX de R$ 4.000 = salário R$ 3.000 + vale R$ 1.000). Combina regras
determinísticas (valores, datas, somas, nomes, padrões) com IA para os casos
ambíguos. É ferramenta de apoio à conferência, não substituto da validação
financeira humana. Disponível no plano Personalizado.

====
id: artisys-finance-dores
module: artisys-finance
tier: extra
kind: problema-solucao
title: Artisys Finance — dores que resolve

Para quem perde muito tempo conferindo extrato e pagamentos manualmente, tem alto
volume de pagamentos, faz um PIX que paga várias coisas ao mesmo funcionário, ou
precisa achar divergências entre o previsto e o que saiu da conta.

Frases típicas: "perco muito tempo conferindo extrato", "faço um PIX que paga
várias coisas ao mesmo funcionário", "perco tempo conferindo pagamento de
funcionário".

====
id: universidade-funcionalidades
module: universidade
tier: extra
kind: funcionalidades
title: Universidade Empresarial — o que é e funcionalidades

Módulo de capacitação dos colaboradores, com conteúdo apresentado como
capacitação profissional (sem rótulos que constranjam). Áreas: Capacitação em
Comunicação, em Leitura e Matemática.

Funcionalidades:
- sondagem inicial de nível
- trilhas de aprendizado progressivas
- exercícios e feedback em ciclos curtos (conteúdo → prática → feedback)
- materiais de apoio
- experiência mobile/PWA, instalável no celular — importante para
  colaboradores que não usam computador

Pode ser vendida separadamente como solução de capacitação corporativa.
Disponível no plano Personalizado.

====
id: universidade-dores
module: universidade
tier: extra
kind: problema-solucao
title: Universidade Empresarial — dores que resolve

Para quem quer treinar melhor a equipe, tem colaboradores com dificuldade de
leitura, comunicação escrita ou matemática, ou quer desenvolver competências que
impactam a rotina profissional.

Frases típicas: "quero treinar melhor minha equipe", "minha equipe tem
dificuldade de leitura e matemática".

====
id: jogos-funcionalidades
module: jogos
tier: extra
kind: funcionalidades
title: Jogos e Gamificação Educacional — o que é e funcionalidades

Camada de gamificação que reforça os conteúdos da Universidade Empresarial.
Os motores geram combinações variadas para reduzir repetição. Os jogos são
vinculados aos conteúdos de capacitação, não são só entretenimento.

Funcionalidades:
- palavras cruzadas
- jogos de palavras
- dominó matemático
- desafios de leitura
- exercícios interativos

Benefícios: mais engajamento, sessões curtas de aprendizado, experiência menos
parecida com um curso tradicional.

Complemento da Universidade Empresarial. Disponível no plano Personalizado.

====
id: assistente-funcionalidades
module: assistente
tier: extra
kind: funcionalidades
title: Assistente Inteligente — o que é e funcionalidades

Camada de apoio ao uso do sistema.

Funcionalidades:
- explica campos e orienta preenchimentos
- indica onde está uma funcionalidade
- explica processos e próximos passos
- responde dúvidas de uso
- ajuda a interpretar informações do sistema

Processos objetivos são tratados por regras do próprio sistema; a IA entra onde
há necessidade de interpretação e orientação. Reduz a curva de aprendizado do
usuário.

Disponível no plano Personalizado.

====
id: objecao-preco
module: geral
tier: geral
kind: objecao
title: Objeção de preço

Diante de objeção de valor, reenquadrar pelo benefício (tempo economizado,
informação no lugar certo, menos retrabalho) e situar nos planos Essencial e
Personalizado. Se o lead quer negociar valor, pedir desconto ou tratar condição
comercial especial, ou se a conversa trava na objeção de preço, transferir para
atendimento humano (`handoffToHuman`).

====
id: objecao-ja-tenho-sistema
module: geral
tier: geral
kind: objecao
title: Objeção "já temos um sistema / usamos planilha"

Reconhecer o que já funciona e explorar a lacuna: normalmente os controles atuais
(planilhas, grupos de WhatsApp, sistemas separados) não conectam obra, escritório
e financeiro. Perguntar como a informação circula hoje entre campo e escritório e
apresentar só o módulo que fecha essa lacuna.

====
id: objecao-e-robo
module: geral
tier: geral
kind: objecao
title: Transparência ("é um robô?")

Ser honesto: é um assistente comercial automatizado que ajuda no primeiro
contato e pode passar para um vendedor humano quando fizer sentido. Não fingir ser
humano.
