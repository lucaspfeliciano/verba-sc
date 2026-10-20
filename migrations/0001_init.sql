-- Verba SC: schema inicial.
-- Convenções: valores monetários em centavos (INTEGER), datas ISO 8601 (TEXT),
-- documentos (CPF/CNPJ) só com dígitos. Todo registro aponta para a coleta de origem.

-- ---------------------------------------------------------------------------
-- Proveniência
-- ---------------------------------------------------------------------------

-- Uma linha por download (ou página de API) de fonte oficial.
CREATE TABLE collection (
  id            INTEGER PRIMARY KEY,
  source        TEXT NOT NULL,     -- alesc | epublica_pmf | epublica_cmf | pncp | tse
  dataset       TEXT NOT NULL,     -- ex.: gabinetes, gastos_favorecido, comissionados
  scope         TEXT NOT NULL,     -- recorte coletado, ex.: '2025' ou '2026-09'
  url           TEXT NOT NULL,
  request_body  TEXT,              -- corpo da requisição quando a fonte é POST
  fetched_at    TEXT NOT NULL,
  http_status   INTEGER,
  bytes         INTEGER,
  sha256        TEXT NOT NULL,
  r2_key        TEXT,              -- cópia bruta no bucket R2 (NULL para TSE: o arquivo fica no TSE)
  rows          INTEGER
);
CREATE INDEX collection_source ON collection(source, dataset, scope);

-- ---------------------------------------------------------------------------
-- TSE (carregado pelo pipeline Python em pipeline/tse_sc.py)
-- ---------------------------------------------------------------------------

-- Pessoa. A chave é derivada do título eleitoral (estável entre eleições);
-- CPF e título não são exibidos no site, servem só para o cruzamento.
CREATE TABLE politician (
  id           TEXT PRIMARY KEY,   -- sha256(título)[:16]
  slug         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  ballot_name  TEXT NOT NULL,      -- nome de urna da candidatura mais recente
  name_norm    TEXT NOT NULL,
  ballot_norm  TEXT NOT NULL,
  cpf          TEXT,
  birth_date   TEXT,
  gender       TEXT,
  photo_url    TEXT
);
CREATE INDEX politician_ballot_norm ON politician(ballot_norm);

CREATE TABLE candidacy (
  sq_candidato   TEXT PRIMARY KEY,
  politician_id  TEXT NOT NULL REFERENCES politician(id),
  year           INTEGER NOT NULL,
  office         TEXT NOT NULL,    -- DEPUTADO ESTADUAL | PREFEITO | VICE-PREFEITO | VEREADOR
  unit           TEXT NOT NULL,    -- SC | FLORIANÓPOLIS
  number         TEXT,
  party          TEXT,
  ballot_name    TEXT NOT NULL,
  status         TEXT,             -- situação da candidatura
  result         TEXT,             -- ELEITO, SUPLENTE, NÃO ELEITO...
  elected        INTEGER NOT NULL DEFAULT 0,
  campaign_cnpj  TEXT,
  collection_id  INTEGER REFERENCES collection(id)
);
CREATE INDEX candidacy_politician ON candidacy(politician_id);
CREATE INDEX candidacy_office ON candidacy(office, year);

CREATE TABLE campaign_receipt (
  id             INTEGER PRIMARY KEY,
  sq_candidato   TEXT NOT NULL REFERENCES candidacy(sq_candidato),
  donor_doc      TEXT,
  donor_name     TEXT,
  donor_name_norm TEXT,
  origin         TEXT,             -- Recursos de pessoas físicas, de partido...
  fund           TEXT,             -- Fundo especial, outros recursos...
  kind           TEXT,             -- PIX, transferência, estimável...
  received_at    TEXT,
  amount_cents   INTEGER NOT NULL,
  collection_id  INTEGER REFERENCES collection(id)
);
CREATE INDEX campaign_receipt_cand ON campaign_receipt(sq_candidato);
CREATE INDEX campaign_receipt_doc ON campaign_receipt(donor_doc);

CREATE TABLE campaign_expense (
  id               INTEGER PRIMARY KEY,
  sq_candidato     TEXT NOT NULL REFERENCES candidacy(sq_candidato),
  supplier_doc     TEXT,
  supplier_name    TEXT,
  supplier_name_norm TEXT,
  category         TEXT,           -- DS_ORIGEM_DESPESA
  description      TEXT,
  spent_at         TEXT,
  amount_cents     INTEGER NOT NULL,
  collection_id    INTEGER REFERENCES collection(id)
);
CREATE INDEX campaign_expense_cand ON campaign_expense(sq_candidato);
CREATE INDEX campaign_expense_doc ON campaign_expense(supplier_doc);
CREATE INDEX campaign_expense_name ON campaign_expense(supplier_name_norm);

CREATE TABLE declared_asset (
  id             INTEGER PRIMARY KEY,
  sq_candidato   TEXT NOT NULL REFERENCES candidacy(sq_candidato),
  kind           TEXT,
  description    TEXT,
  amount_cents   INTEGER NOT NULL,
  collection_id  INTEGER REFERENCES collection(id)
);
CREATE INDEX declared_asset_cand ON declared_asset(sq_candidato);

-- ---------------------------------------------------------------------------
-- ALESC: despesas dos gabinetes parlamentares (CSV anual)
-- ---------------------------------------------------------------------------

CREATE TABLE alesc_expense (
  id             INTEGER PRIMARY KEY,
  year           INTEGER NOT NULL,
  ref_date       TEXT,
  category       TEXT NOT NULL,    -- coluna "Verba": DIÁRIAS, REEMBOLSOS, ALUGUEL...
  description    TEXT,
  account        TEXT NOT NULL,    -- coluna "Conta": nome do gabinete/deputado
  payee          TEXT,
  payee_norm     TEXT,
  route          TEXT,             -- coluna "Trecho" (passagens/diárias)
  amount_cents   INTEGER NOT NULL,
  collection_id  INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX alesc_expense_year ON alesc_expense(year, account);
CREATE INDEX alesc_expense_account ON alesc_expense(account, year);
CREATE INDEX alesc_expense_payee ON alesc_expense(payee_norm);

-- ---------------------------------------------------------------------------
-- e-Publica (Prefeitura = entidade 2002, Câmara = entidade 1018)
-- ---------------------------------------------------------------------------

-- "Gastos por favorecido": total anual por favorecido.
CREATE TABLE epublica_payee_year (
  entity            INTEGER NOT NULL,
  year              INTEGER NOT NULL,
  doc               TEXT NOT NULL,   -- dígitos (CNPJ 14, CPF 11; CPF pode vir mascarado)
  doc_fmt           TEXT,
  name              TEXT NOT NULL,
  name_norm         TEXT NOT NULL,
  committed_cents   INTEGER NOT NULL DEFAULT 0,
  cancelled_cents   INTEGER NOT NULL DEFAULT 0,
  liquidated_cents  INTEGER NOT NULL DEFAULT 0,
  paid_cents        INTEGER NOT NULL DEFAULT 0,
  collection_id     INTEGER NOT NULL REFERENCES collection(id),
  PRIMARY KEY (entity, year, doc, name)
);
CREATE INDEX epublica_payee_doc ON epublica_payee_year(doc);
CREATE INDEX epublica_payee_rank ON epublica_payee_year(entity, year, paid_cents DESC);

-- Cargos comissionados da Câmara (inclui assessores de gabinete), foto mensal.
CREATE TABLE cmf_staff (
  entity          INTEGER NOT NULL,
  ref_month       TEXT NOT NULL,     -- 'AAAA-MM'
  registration    TEXT NOT NULL,     -- matrícula
  name            TEXT NOT NULL,
  role            TEXT,
  office          TEXT,              -- lotação, ex.: 'Gabinete Fulano'
  bond            TEXT,
  admitted_at     TEXT,
  gross_cents     INTEGER NOT NULL DEFAULT 0,
  discounts_cents INTEGER NOT NULL DEFAULT 0,
  collection_id   INTEGER NOT NULL REFERENCES collection(id),
  PRIMARY KEY (entity, ref_month, registration)
);
CREATE INDEX cmf_staff_office ON cmf_staff(office, ref_month);

-- Diárias pagas pela Prefeitura, por empenho. O CPF nunca é exibido no site.
CREATE TABLE pmf_per_diem (
  entity          INTEGER NOT NULL,
  empenho_id      INTEGER NOT NULL,
  year            INTEGER NOT NULL,
  issued_at       TEXT,
  beneficiary     TEXT NOT NULL,
  beneficiary_norm TEXT NOT NULL,
  doc             TEXT,
  role            TEXT,
  unit            TEXT,
  committed_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents      INTEGER NOT NULL DEFAULT 0,
  collection_id   INTEGER NOT NULL REFERENCES collection(id),
  PRIMARY KEY (entity, empenho_id)
);
CREATE INDEX pmf_per_diem_name ON pmf_per_diem(beneficiary_norm);
CREATE INDEX pmf_per_diem_year ON pmf_per_diem(year);

-- ---------------------------------------------------------------------------
-- PNCP: contratos publicados pela Prefeitura
-- ---------------------------------------------------------------------------

CREATE TABLE pncp_contract (
  control_number  TEXT PRIMARY KEY,
  organ_cnpj      TEXT NOT NULL,
  unit_name       TEXT,
  year            INTEGER NOT NULL,
  supplier_doc    TEXT,
  supplier_name   TEXT,
  object          TEXT,
  initial_cents   INTEGER,
  global_cents    INTEGER,
  signed_at       TEXT,
  valid_from      TEXT,
  valid_to        TEXT,
  collection_id   INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX pncp_contract_supplier ON pncp_contract(supplier_doc);
CREATE INDEX pncp_contract_year ON pncp_contract(year);

-- ---------------------------------------------------------------------------
-- Ligações e sinais (dados derivados, recalculados a cada ingestão)
-- ---------------------------------------------------------------------------

-- Liga o nome usado por uma fonte de mandato (conta ALESC, gabinete da Câmara)
-- a uma pessoa do TSE. method: exact | tokens | manual. 'manual' nunca é apagado.
CREATE TABLE mandate_link (
  source         TEXT NOT NULL,      -- alesc | cmf
  alias          TEXT NOT NULL,
  politician_id  TEXT NOT NULL REFERENCES politician(id),
  method         TEXT NOT NULL,
  PRIMARY KEY (source, alias)
);
CREATE INDEX mandate_link_politician ON mandate_link(politician_id);

CREATE TABLE signal (
  id             INTEGER PRIMARY KEY,
  rule           TEXT NOT NULL,
  rule_version   TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL,
  politician_id  TEXT REFERENCES politician(id),
  doc            TEXT,
  amount_cents   INTEGER,
  evidence       TEXT NOT NULL,      -- JSON com os registros que sustentam o sinal
  created_at     TEXT NOT NULL
);
CREATE INDEX signal_rule ON signal(rule, severity);
CREATE INDEX signal_politician ON signal(politician_id);
CREATE INDEX signal_doc ON signal(doc);

-- Status da última execução de cada etapa de ingestão (para a página /fontes).
CREATE TABLE ingest_run (
  id           INTEGER PRIMARY KEY,
  instance_id  TEXT NOT NULL,
  step         TEXT NOT NULL,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  ok           INTEGER,
  summary      TEXT
);
