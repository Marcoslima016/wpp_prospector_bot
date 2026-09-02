-- 0001_init — fundação do armazenamento SQL embutido.
-- Cria apenas a tabela de controle de versões do esquema. As tabelas de negócio
-- (consumo de LLM, consumo de WhatsApp, projeção de conversas) chegam nas changes
-- seguintes, cada uma com sua própria migration numerada.
--
-- O runner também garante esta tabela via CREATE TABLE IF NOT EXISTS antes de
-- consultar o que já foi aplicado; declará-la aqui mantém o esquema reproduzível
-- a partir apenas do diretório de migrations.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
