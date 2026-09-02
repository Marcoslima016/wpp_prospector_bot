/**
 * Catálogo estável dos módulos do ecossistema Obra na Mão / FluxoDRE.
 *
 * Ponto único de verdade para os identificadores de módulo (kebab-case). É
 * reutilizado pelo schema da `BotDecision` (`recommendedModules` /
 * `interestedModules`), pelos metadados dos trechos da base de conhecimento
 * (`sales-knowledge.md`) e pelo mapa de sinônimos da recuperação léxica.
 *
 * `base`  → módulos do plano Essencial (o bot lidera a venda por eles).
 * `extra` → módulos que só entram no plano Personalizado (sem contratação avulsa).
 */

export const BASE_MODULE_IDS = [
  "gestao-obras",
  "obra360",
  "equipes-presenca",
  "planejamento-frentes",
  "checklists",
  "fluxodre-desktop",
  "colaboradores-documentos",
  "vales-pagamentos",
  "dre-custos",
  "hub",
] as const;

export const EXTRA_MODULE_IDS = ["artisys-finance", "universidade", "jogos", "assistente"] as const;

/** Todos os identificadores de módulo, base + extra. */
export const MODULE_IDS = [...BASE_MODULE_IDS, ...EXTRA_MODULE_IDS] as const;

export type ModuleId = (typeof MODULE_IDS)[number];
export type BaseModuleId = (typeof BASE_MODULE_IDS)[number];
export type ExtraModuleId = (typeof EXTRA_MODULE_IDS)[number];

/** Camada comercial de um trecho da base: módulo base, módulo extra ou conteúdo geral. */
export const MODULE_TIERS = ["base", "extra", "geral"] as const;
export type ModuleTier = (typeof MODULE_TIERS)[number];

/** Rótulos legíveis por módulo, para uso em relatórios e no brief de handoff. */
export const MODULE_LABELS: Record<ModuleId, string> = {
  "gestao-obras": "Gestão de Obras / Obra na Mão Campo",
  obra360: "Obra360",
  "equipes-presenca": "Gestão de Equipes e Presença",
  "planejamento-frentes": "Planejamento e Frentes de Serviço",
  checklists: "Checklists e Controle Operacional",
  "fluxodre-desktop": "FluxoDRE Desktop / Gestão Administrativa",
  "colaboradores-documentos": "Gestão de Colaboradores e Documentos",
  "vales-pagamentos": "Vales, Pagamentos e Obrigações",
  "dre-custos": "DRE, Custos e Centros de Custo",
  hub: "Hub Obra na Mão",
  "artisys-finance": "Artisys Finance — Financeiro Inteligente",
  universidade: "Universidade Empresarial",
  jogos: "Jogos e Gamificação Educacional",
  assistente: "Assistente Inteligente de Uso do Sistema",
};

const MODULE_ID_SET: ReadonlySet<string> = new Set(MODULE_IDS);
const BASE_MODULE_ID_SET: ReadonlySet<string> = new Set(BASE_MODULE_IDS);

export function isModuleId(value: string): value is ModuleId {
  return MODULE_ID_SET.has(value);
}

export function moduleTier(id: ModuleId): Exclude<ModuleTier, "geral"> {
  return BASE_MODULE_ID_SET.has(id) ? "base" : "extra";
}

/**
 * Planos comerciais. `essencial` = plano base; `personalizado` = plano completo,
 * que libera todos os módulos `extra` por um valor único acima do base.
 */
export const COMMERCIAL_PLANS = ["essencial", "personalizado"] as const;
export type CommercialPlan = (typeof COMMERCIAL_PLANS)[number];
