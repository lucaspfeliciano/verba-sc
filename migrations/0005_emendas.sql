-- Emendas parlamentares federais de autoria de deputados federais e senadores de SC
-- (e da bancada catarinense). Fonte: Portal da Transparência (CGU), arquivo único.

CREATE TABLE emenda (
  code              TEXT PRIMARY KEY,   -- Código da Emenda (ano + autor + número)
  year              INTEGER NOT NULL,
  type              TEXT,               -- Individual, de bancada, transferência especial...
  author_code       TEXT,
  author_name       TEXT NOT NULL,
  author_norm       TEXT NOT NULL,
  number            TEXT,
  locality          TEXT,               -- localidade de aplicação do recurso
  municipio_ibge    TEXT,
  municipio         TEXT,
  uf                TEXT,
  funcao            TEXT,
  programa          TEXT,
  acao              TEXT,
  committed_cents   INTEGER NOT NULL DEFAULT 0,
  liquidated_cents  INTEGER NOT NULL DEFAULT 0,
  paid_cents        INTEGER NOT NULL DEFAULT 0,
  rp_paid_cents     INTEGER NOT NULL DEFAULT 0,   -- restos a pagar pagos (anos seguintes)
  collection_id     INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX emenda_author ON emenda(author_norm, year);
CREATE INDEX emenda_municipio ON emenda(municipio_ibge);

-- Quem recebeu o dinheiro de cada emenda (CNPJ/CPF), mês a mês.
CREATE TABLE emenda_favorecido (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL,
  author_norm    TEXT NOT NULL,
  year_month     TEXT,                -- 'AAAAMM'
  doc            TEXT,
  name           TEXT,
  name_norm      TEXT,
  natureza       TEXT,                -- natureza jurídica
  kind           TEXT,                -- Pessoa Jurídica, Pessoa Física, Unidade Gestora...
  uf             TEXT,
  municipio      TEXT,
  amount_cents   INTEGER NOT NULL,
  collection_id  INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX emenda_favorecido_code ON emenda_favorecido(code);
CREATE INDEX emenda_favorecido_doc ON emenda_favorecido(doc);
CREATE INDEX emenda_favorecido_author ON emenda_favorecido(author_norm);

CREATE TABLE emenda_convenio (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL,
  convenente     TEXT,
  objeto         TEXT,
  numero         TEXT,
  published_at   TEXT,
  locality       TEXT,
  amount_cents   INTEGER NOT NULL,
  collection_id  INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX emenda_convenio_code ON emenda_convenio(code);
