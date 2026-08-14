# PRD - WhatsApp Lead Prospector Bot (Outbound Engine)

| Informação | Detalhes |
| :--- | :--- |
| **Status** | Aprovado para Desenvolvimento |
| **Product Manager** | Time de Produto |
| **Tech Lead** | Engenharia de Software |
| **Versão** | 1.0.0 |
| **Data de Criação** | 13/08/2026 |

---

## 1. Visão Geral & Problema

### 1.1. Visão Geral
O **WhatsApp Lead Prospector Bot** é uma plataforma automatizada de prospecção ativa (*outbound*) via WhatsApp. A solução permite o disparo inteligente de mensagens personalizadas para listas de potenciais leads, conduz qualificações iniciais por meio de conversação natural/IA e agenda reuniões ou direciona contatos qualificados diretamente para o time de pré-vendas (SDRs).

### 1.2. Declaração do Problema
Equipes de vendas B2B e de serviços gastam até 40% do tempo executando abordagens manuais repetitivas via WhatsApp ou e-mail, resultando em baixas taxas de resposta, alto custo de aquisição de clientes (CAC) e vulnerabilidade ao bloqueio de números de telefone por uso inadequado da ferramenta de mensageria.

### 1.3. Público-Alvo
* **Gestores de Vendas / SDRs:** Responsáveis por operacionalizar campanhas de prospecção e qualificar o pipeline.
* **Potenciais Leads (B2B / B2C):** Destinatários que recebem a abordagem inicial e interagem com a solução.
* **Administradores da Plataforma:** Responsáveis pela saúde dos números e configurações de inteligência.

---

## 2. Objetivos de Negócio & Métricas (KPIs)

### 2.1. Objetivos de Negócio
* Escalar o volume de prospecção ativa sem necessidade de aumentar proporcionalmente a equipe de SDRs.
* Aumentar em 3x a taxa de engajamento inicial comparado a abordagens frias por e-mail (*Cold Mail*).
* Garantir a segurança operacional dos chips/números operados através de algoritmos de aquecimento e *throttling*.

### 2.2. Métricas de Sucesso
| Métrica | Meta do MVP |
| :--- | :--- |
| **Taxa de Entrega de Mensagens** | > 95% das mensagens enviadas com sucesso |
| **Taxa de Resposta de Leads** | > 18% de respostas interativas dos contatos abordados |
| **Taxa de Qualificação de Lead (SQL)** | > 25% dos leads respondidos convertidos em reuniões/handoffs |
| **Taxa de Banimento de Número** | < 2% da base total de chips ativos por mês |

---

## 3. Histórias de Usuário & Requisitos Funcionais

### 3.1. Histórias de Usuário
* **Como Gestor de Vendas**, quero importar uma lista de contatos (CSV/XLSX ou via webhook) para que o bot inicie abordagens personalizadas automaticamente.
* **Como SDR**, quero ser notificado no momento exato em que um lead responder com alto interesse para assumir a conversa manualmente.
* **Como Lead**, quero poder tirar dúvidas iniciais sobre a solução oferecida para entender se faz sentido agendar uma apresentação.
* **Como Administrador**, quero configurar intervalos dinâmicos de envio para evitar que o WhatsApp classifique as contas como spam.

### 3.2. Requisitos Funcionais (RF)
| ID | Módulo | Descrição do Requisito | Prioridade |
| :--- | :--- | :--- | :--- |
| **RF-01** | Gestão de Leads | O sistema deve permitir upload de arquivos CSV/XLSX com dados de leads (Nome, Empresa, Telefone, Variáveis Customizadas). | Must Have |
| **RF-02** | Campanhas | O sistema deve permitir criação de templates de mensagens com variáveis dinâmicas (ex: "Olá {nome}, vi que você atua na {empresa}"). | Must Have |
| **RF-03** | Motor de Conversa | O bot deve responder interativamente aos leads com suporte a LLM (IA Conversacional) seguindo o script/playbook cadastrado. | Must Have |
| **RF-04** | Qualificação | O bot deve categorizar a intenção do lead em: *Interessado*, *Sem Interesse*, *Dúvida*, *Opt-out (Descadastro)*. | Must Have |
| **RF-05** | Handoff Humano | O sistema deve transferir a conversa automaticamente para um operador humano quando o lead atingir pontuação de qualificação. | Must Have |
| **RF-06** | Anti-Ban / Warmup | O sistema deve controlar cadência de disparos (*throttling*), rotação de números e simulação de digitação humana. | Must Have |
| **RF-07** | Opt-Out Automático | O bot deve reconhecer termos como "sair", "parar", "não tenho interesse" e remover o contato da lista imediatamente. | Must Have |
| **RF-08** | Agendamento | Integarção com plataformas de agenda (Google Calendar / Cal.com) para envio de links diretos de agendamento. | Should Have |

---

## 4. Requisitos Não-Funcionais (RNF)

* **Segurança & LGPD:** Armazenamento criptografado (AES-256) de dados sensíveis dos leads e conformidade rigorosa com consentimento/opt-out conforme a LGPD.
* **Escalabilidade:** Capacidade de processar até 50.000 disparos diários distribuídos entre múltiplos números de WhatsApp.
* **Latência de Resposta:** O tempo de resposta do bot de IA em conversas ativas não deve exceder 5 segundos.
* **Integração WhatsApp API:** Suporte oficial via WhatsApp Cloud API (Meta BSP) ou conexão multissessão.

---

## 5. Arquitetura do Fluxo de Conversação

```text
[Início da Campanha] 
       │
       ▼
[Envio da Mensagem Personalizada] ➔ (Variáveis: Nome, Empresa)
       │
       ├─► Lead não responde ➔ [Regra de Follow-up após 24h/48h]
       │
       └─► Lead responde
              │
              ├── Resposta Negativa / Opt-out ➔ [Adiciona à Lista Negra / Encerra]
              │
              ├── Dúvida Geral ➔ [Bot de IA responde com base na Knowledge Base]
              │
              └── Demonstra Interesse / Perfil Qualificado 
                     │
                     ▼
              [Dispara Notificação ao SDR / Envia Link de Agendamento]
```

---

## 6. Dependências & Fora do Escopo

### 6.1. Dependências Técnicas
* Provedor de WhatsApp Business API ou gateway multissessão de WhatsApp.
* Provedor de LLM (OpenAI API / Claude API) configurado com System Prompt e limites de contexto.
* CRM / Webhooks para sincronização de novos contatos qualificados (ex: HubSpot, RD Station, Pipedrive).

### 6.2. Fora do Escopo (v1.0)
* Atendimento e prospecção ativa por chamada de voz de IA.
* Envio massivo de mídias pesadas (vídeos > 50MB ou documentos compactados).
* Processamento de pagamentos diretamente na janela de bate-papo do WhatsApp.

---

## 7. Matriz de Riscos & Mitigações

| Risco Identificado | Impacto | Ação de Mitigação |
| :--- | :--- | :--- |
| **Bloqueio/Banimento do número pela Meta** | Alto | Implementar rotação de instâncias, envio em lotes fracionados, aquecimento prévio do número e opt-out explícito. |
| **Alucinação da IA em dúvidas técnicas** | Médio | Utilizar arquitetura RAG (Retrieval-Augmented Generation) com base de conhecimento estrita e fallback imediato para SDRs. |
| **Overload de leads sem SDRs suficientes** | Médio | Limites diários de engajamento baseados no horário comercial e capacidade ativa do time de vendas. |