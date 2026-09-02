/**
 * Mapa de jargão de campo (PT-BR) → termos canônicos / ids de módulo.
 *
 * Usado para expandir a query da busca léxica: cliente de obra fala num jargão
 * que não bate literalmente com a redação formal de `sales-knowledge.md`. Cada
 * chave é comparada tanto como token isolado quanto como expressão (substring da
 * mensagem normalizada). Chaves e valores devem estar normalizados
 * (minúsculas, sem acento) — a normalização é reforçada em runtime de qualquer
 * forma.
 *
 * Manter enxuto e revisar contra o teste de recuperação (`retrieval-eval`).
 */
export const FIELD_SYNONYMS: Record<string, string[]> = {
  // operação de campo / gestão de obras
  encarregado: ["gestao-obras", "campo", "equipe"],
  "manda no whatsapp": ["gestao-obras", "campo", "registro"],
  "manda tudo por whatsapp": ["gestao-obras", "campo", "registro"],
  "grupo de whatsapp": ["gestao-obras", "campo", "registro"],
  zap: ["gestao-obras", "registro"],
  "diario de obra": ["gestao-obras", "historico"],
  historico: ["gestao-obras", "obra360", "historico"],

  // obra360 / pavimentos / frentes
  andar: ["pavimento", "obra360", "planejamento-frentes"],
  andares: ["pavimento", "obra360", "planejamento-frentes"],
  pavimento: ["obra360", "planejamento-frentes"],
  frente: ["planejamento-frentes", "servico"],
  frentes: ["planejamento-frentes", "servico"],
  "frente de servico": ["planejamento-frentes"],
  pendencia: ["obra360"],
  pendencias: ["obra360"],
  planejar: ["planejamento-frentes"],
  planejamento: ["planejamento-frentes", "obra360"],

  // equipes e presença
  equipe: ["equipes-presenca", "gestao-obras"],
  equipes: ["equipes-presenca", "gestao-obras"],
  time: ["equipes-presenca"],
  "bater ponto": ["equipes-presenca", "presenca"],
  ponto: ["equipes-presenca", "presenca"],
  presenca: ["equipes-presenca"],
  falta: ["equipes-presenca", "presenca"],
  faltas: ["equipes-presenca", "presenca"],

  // checklists
  checklist: ["checklists"],
  "check list": ["checklists"],
  verificacao: ["checklists"],
  padronizar: ["checklists"],

  // administrativo / planilhas / documentos
  planilha: ["fluxodre-desktop", "colaboradores-documentos"],
  planilhas: ["fluxodre-desktop", "colaboradores-documentos"],
  excel: ["fluxodre-desktop", "colaboradores-documentos"],
  escritorio: ["fluxodre-desktop"],
  documento: ["colaboradores-documentos"],
  documentos: ["colaboradores-documentos"],
  pasta: ["colaboradores-documentos"],
  "pasta fisica": ["colaboradores-documentos"],

  // vales / pagamentos / folha
  vale: ["vales-pagamentos"],
  vales: ["vales-pagamentos"],
  pagamento: ["vales-pagamentos", "artisys-finance"],
  pagamentos: ["vales-pagamentos", "artisys-finance"],
  recibo: ["vales-pagamentos"],
  folha: ["vales-pagamentos"],
  obrigacao: ["vales-pagamentos", "artisys-finance"],
  obrigacoes: ["vales-pagamentos", "artisys-finance"],

  // DRE / custos
  custo: ["dre-custos"],
  custos: ["dre-custos"],
  "quanto custa a obra": ["dre-custos"],
  "custo por obra": ["dre-custos"],
  lucro: ["dre-custos"],
  resultado: ["dre-custos"],
  dre: ["dre-custos"],
  "centro de custo": ["dre-custos"],
  medicao: ["dre-custos", "custos"],
  aditivo: ["dre-custos", "custos"],

  // artisys finance / conciliação
  extrato: ["artisys-finance", "conciliacao"],
  extratos: ["artisys-finance", "conciliacao"],
  conciliacao: ["artisys-finance"],
  conciliar: ["artisys-finance"],
  pix: ["artisys-finance", "conciliacao"],
  "conferir pagamento": ["artisys-finance", "vales-pagamentos"],
  "conferindo extrato": ["artisys-finance"],
  divergencia: ["artisys-finance"],
  banco: ["artisys-finance"],
  bancario: ["artisys-finance"],

  // universidade / capacitação / jogos
  treinar: ["universidade"],
  treinamento: ["universidade"],
  capacitar: ["universidade"],
  capacitacao: ["universidade"],
  leitura: ["universidade", "jogos"],
  matematica: ["universidade", "jogos"],
  comunicacao: ["universidade"],
  curso: ["universidade"],
  gamificacao: ["jogos"],
  jogo: ["jogos"],
  jogos: ["jogos"],

  // assistente / hub
  assistente: ["assistente"],
  "duvida de uso": ["assistente"],
  "como faz": ["assistente"],
  hub: ["hub"],
  acesso: ["hub"],
  login: ["hub"],
};
