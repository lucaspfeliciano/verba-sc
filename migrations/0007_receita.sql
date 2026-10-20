-- Receita Federal (via BrasilAPI): cadastro e quadro de sócios de CNPJs que recebem
-- dinheiro de políticos de SC. Coleta incremental.

CREATE TABLE company_registry (
  cnpj           TEXT PRIMARY KEY,
  name           TEXT,
  trade_name     TEXT,
  status         TEXT,              -- situação cadastral (ATIVA, BAIXADA...)
  opened_at      TEXT,
  cnae           TEXT,
  city           TEXT,
  uf             TEXT,
  legal_nature   TEXT,
  capital_cents  INTEGER,
  fetched_at     TEXT NOT NULL,
  http_status    INTEGER,           -- 404 = CNPJ não encontrado na base
  collection_id  INTEGER REFERENCES collection(id)
);

CREATE TABLE company_partner (
  id             INTEGER PRIMARY KEY,
  cnpj           TEXT NOT NULL,
  name           TEXT NOT NULL,
  name_norm      TEXT NOT NULL,
  doc_masked     TEXT,              -- como a Receita publica: '***123456**' (PF) ou raiz do CNPJ (PJ)
  doc6           TEXT,              -- PF: os 6 dígitos visíveis do CPF (posições 4 a 9)
  root           TEXT,              -- PJ: raiz do CNPJ do sócio (8 dígitos)
  is_company     INTEGER NOT NULL DEFAULT 0,
  role           TEXT,
  entered_at     TEXT,
  collection_id  INTEGER REFERENCES collection(id)
);
CREATE INDEX company_partner_cnpj ON company_partner(cnpj);
CREATE INDEX company_partner_person ON company_partner(name_norm, doc6);
CREATE INDEX company_partner_root ON company_partner(root);
