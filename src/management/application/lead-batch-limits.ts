/**
 * Limites dos fluxos de leads em massa. Ajustáveis sem mexer em spec (o requisito
 * só fala em "limite máximo configurado"). Começam conservadores para o volume
 * atual (dezenas de leads por operação).
 */

/** Máximo de itens aceitos num único `POST /admin/api/leads/import`. */
export const MAX_IMPORT_ROWS = 1000;

/** Máximo de telefones aceitos num único `POST /admin/api/leads/prospect`. */
export const MAX_PROSPECT_BATCH = 100;

/** Disparos de prospecção simultâneos entre telefones distintos no lote. */
export const PROSPECT_CONCURRENCY = 4;
