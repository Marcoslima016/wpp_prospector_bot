/**
 * Configuração do template aprovado usado como primeiro contato de prospecção.
 * Resolvida a partir do ambiente (`PROSPECTING_TEMPLATE_*`) e injetada no
 * `ProspectLeadUseCase`. `paramKeys` dá a ordem posicional dos parâmetros do
 * template: um disparo pode informar os valores como objeto nomeado (mapeado por
 * essas chaves) ou como array já na ordem certa.
 */
export interface FirstContactTemplateConfig {
  name: string;
  lang: string;
  paramKeys: string[];
}
