# Planos e preços — Obra na Mão / FluxoDRE

<!--
Conteúdo SEMPRE presente no contexto do bot (pinned). É a única fonte de preços
em runtime. Para alterar valores ou condições: editar aqui e reiniciar o processo.
O arquivo inteiro é injetado como bloco fixo; não usa metadados de trecho.
-->

## Planos

| Plano | O que inclui | Valor |
|---|---|---|
| **Essencial** | Plano base: os módulos de operação de campo, gestão administrativa e DRE/custos, com funcionalidades reduzidas | **R$ 200/mês** |
| **Personalizado** | Tudo do Essencial **+** todos os módulos do conjunto adicional (Artisys Finance, Universidade Empresarial, Jogos e Gamificação, Assistente Inteligente) | **R$ 350/mês** (Essencial + R$ 150/mês) |

O plano Personalizado é o plano completo: um único valor acima do Essencial que
**libera todos os módulos do conjunto adicional de uma vez**. Não é seleção "à la
carte" — não existe contratação avulsa de um módulo do conjunto adicional.

## Como o bot usa isso

- Quando o lead pergunta "quanto custa?": informar o valor mensal do Essencial
  (R$ 200/mês) e mencionar o Personalizado (R$ 350/mês, ou seja, R$ 150/mês a
  mais) como o plano que libera todos os módulos do conjunto adicional.
- Citar os planos e valores é permitido e esperado. Só isso — nada além da tabela
  acima.
- Se o lead pede desconto, quer negociar o valor, pergunta por condição especial,
  plano anual, isenção de implantação, período de teste ou qualquer termo que não
  esteja escrito aqui: transferir para atendimento humano (`handoffToHuman`). Não
  inventar condição comercial.

## Termos do lançamento

- Cobrança mensal, sem fidelidade.
- Preço único por plano — sem cobrança variável por usuário ou por obra.
- Qualquer outra condição (desconto, plano anual, implantação, teste) é tratada
  por um vendedor humano.
