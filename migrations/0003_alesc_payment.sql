-- ALESC: pagamentos a credores (quem a Assembleia paga de fato, com CPF/CNPJ).
-- Fonte: https://transparencia.alesc.sc.gov.br/pagamentos/dados-abertos
-- A folha de pessoal, diárias de servidores e ressarcimentos médicos não são coletados.
CREATE TABLE alesc_payment (
  id               INTEGER PRIMARY KEY,
  year             INTEGER NOT NULL,
  doc              TEXT,              -- CNPJ (14 dígitos); NULL para CPF, que a fonte já publica mascarado
  doc_fmt          TEXT,              -- como publicado (CNPJ formatado ou CPF mascarado)
  credor           TEXT NOT NULL,
  credor_norm      TEXT NOT NULL,
  empenho          TEXT,
  modality         TEXT,              -- Ordinário, Estimativo, Global
  subacao          TEXT,              -- 15915 = atividade parlamentar dos gabinetes (a partir de 2024)
  natureza         TEXT NOT NULL,     -- natureza da despesa, ex.: 33903947
  subelemento      TEXT,
  complemento      TEXT,              -- gabinete/deputado de referência, cortado em 20 caracteres
  complemento_norm TEXT,
  liquid_doc       TEXT,              -- documento da liquidação (nota fiscal, fatura...)
  liquid_date      TEXT,
  paid_date        TEXT,
  paid_cents       INTEGER NOT NULL DEFAULT 0,
  collection_id    INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX alesc_payment_year ON alesc_payment(year, natureza);
CREATE INDEX alesc_payment_comp ON alesc_payment(complemento_norm, year);
CREATE INDEX alesc_payment_credor ON alesc_payment(credor_norm);
CREATE INDEX alesc_payment_doc ON alesc_payment(doc);

-- Favorecido do CSV de gabinetes -> CNPJ, quando o mesmo nome aparece com um único
-- CNPJ nos pagamentos a credores. Recalculado na etapa "derive".
CREATE TABLE alesc_payee_doc (
  payee_norm  TEXT PRIMARY KEY,
  doc         TEXT NOT NULL,
  credor      TEXT NOT NULL
);
