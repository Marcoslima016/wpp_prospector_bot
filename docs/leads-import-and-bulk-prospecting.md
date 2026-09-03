# Importação e disparo em massa de leads

Fluxo operacional entregue pela change `add-lead-import-and-bulk-prospecting`.

## Fluxo

1. **Importar planilha** — o painel (`/admin/leads` → "Importar planilha") lê um
   `.xlsx` na máquina do operador, reconhece a aba `03_Leads_CRM` (ou pela
   heurística de cabeçalho), extrai empresa/nome, telefone, segmento e cidade,
   normaliza cada telefone para E.164 brasileiro e mostra um preview
   (válidos + rejeitados com motivo). Ao confirmar, envia
   `POST /admin/api/leads/import` **só com os válidos**. A importação **nunca
   dispara mensagem**; leads novos entram em `pending`. Numa re-importação do
   mesmo telefone, os valores da planilha **sobrescrevem** os do banco.
2. **Listar / filtrar** — `GET /admin/api/leads` (paginado por cursor; filtros por
   estado de prospecção, trecho de telefone e segmento).
3. **Disparar a abertura em lote** — selecionar leads `pending`/`failed` e
   confirmar. `POST /admin/api/leads/prospect` reusa o `ProspectLeadUseCase`
   individual por telefone: **continue-on-error** (um lead que falha não aborta o
   lote), idempotente por lead (sem `force`, `sent`/`replied` viram `skipped`),
   resposta com o desfecho por telefone (`sent` + `wamid` | `skipped` | `failed` +
   motivo). Sempre HTTP 200 quando a request foi processada.
4. **Resetar um lead** — `POST /admin/api/leads/:leadPhone/reset` devolve um lead
   já contatado a `pending` e limpa os carimbos de primeiro contato. **Não apaga a
   conversa**; um disparo posterior acrescenta um novo turno à conversa existente.

`GET /admin/api/capabilities` (`{ conversationActions, prospecting }`) diz ao
painel quando exibir/ocultar as afordâncias de disparo.

## Limites (constantes em `src/management/application/lead-batch-limits.ts`)

| Constante              | Valor | O que limita                                                        |
| ---------------------- | ----- | ------------------------------------------------------------------- |
| `MAX_IMPORT_ROWS`      | 1000  | Itens por `POST /admin/api/leads/import`; acima → HTTP 422.         |
| `MAX_PROSPECT_BATCH`   | 100   | Telefones por `POST /admin/api/leads/prospect`; acima → HTTP 422.   |
| `PROSPECT_CONCURRENCY` | 4     | Disparos simultâneos entre telefones distintos (a serialização por lead vem da `LeadSerialQueue`). |

O disparo em lote é **síncrono** — a request segura até o lote terminar. O volume
atual (dezenas) é resolvido assim; disparo assíncrono com progresso fica para uma
change futura se o volume crescer.

## Configuração

```
PROSPECTING_TEMPLATE_NAME=abertura_lead_obras
PROSPECTING_TEMPLATE_LANG=pt_BR
# sem PROSPECTING_TEMPLATE_PARAM_KEYS — o template não tem variáveis
```

DDI Brasil (55) é fixo na normalização de telefone; não há suporte a leads fora
do Brasil.
