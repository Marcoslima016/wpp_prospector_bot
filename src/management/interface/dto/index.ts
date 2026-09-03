/**
 * Superfície pública dos contratos de resposta da API de gestão, consumida pela
 * SPA (`applications/wpp_prospector_bot_panel/`) via o export de subcaminho
 * `wpp_prospector_bot_server/contracts`.
 *
 * Reexporta os schemas zod versionados (item de lista, detalhe de conversa,
 * série de consumo, contadores do estado atual), os schemas de query e a
 * constante `MANAGEMENT_CONTRACT_VERSION`. Faça bump da versão em `common.ts` ao
 * alterar a forma de qualquer DTO de forma incompatível.
 */
export * from "./common.ts";
export * from "./query.ts";
export * from "./conversation.dto.ts";
export * from "./consumption.dto.ts";
export * from "./overview.dto.ts";
