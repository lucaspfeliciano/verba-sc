-- Poder Executivo de Santa Catarina (governador, vice e secretarias).
-- Fonte: dados.sc.gov.br (Secretaria de Estado da Fazenda), empenhos anuais e contratos.

-- Empenho líquido por ano, credor e órgão (emissão + reforço - anulação - estorno).
CREATE TABLE state_payee_year (
  year             INTEGER NOT NULL,
  doc              TEXT NOT NULL,     -- CNPJ/CPF só dígitos, ou 'NOME:<nome>' quando não há documento
  name             TEXT NOT NULL,
  name_norm        TEXT NOT NULL,
  orgao            TEXT NOT NULL,
  committed_cents  INTEGER NOT NULL,
  n                INTEGER NOT NULL,
  collection_id    INTEGER NOT NULL REFERENCES collection(id),
  PRIMARY KEY (year, doc, orgao)
);
CREATE INDEX state_payee_doc ON state_payee_year(doc);
CREATE INDEX state_payee_rank ON state_payee_year(year, committed_cents DESC);

-- Totais por órgão e função (área) no ano.
CREATE TABLE state_orgao_year (
  year             INTEGER NOT NULL,
  orgao            TEXT NOT NULL,
  funcao           TEXT NOT NULL,
  committed_cents  INTEGER NOT NULL,
  PRIMARY KEY (year, orgao, funcao)
);

-- Empenhos em detalhe: Gabinete do Governador, Vice-Governadoria, Comunicação
-- e qualquer empenho cujo credor é o próprio governador ou vice (pelo CPF do TSE).
CREATE TABLE state_empenho (
  id               INTEGER PRIMARY KEY,
  year             INTEGER NOT NULL,
  issued_at        TEXT,
  nota             TEXT,
  kind             TEXT,               -- Emissão, Reforço, Anulação, Estorno
  history          TEXT,
  modality         TEXT,               -- modalidade de licitação
  contract         TEXT,
  doc              TEXT,
  name             TEXT,
  orgao            TEXT NOT NULL,
  ug               TEXT,
  funcao           TEXT,
  action           TEXT,
  element          TEXT,
  amount_cents     INTEGER NOT NULL,   -- já com sinal (anulação e estorno negativos)
  collection_id    INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX state_empenho_year ON state_empenho(year, orgao);
CREATE INDEX state_empenho_doc ON state_empenho(doc);

CREATE TABLE state_contract (
  id               INTEGER PRIMARY KEY,
  ug               TEXT,
  number           TEXT,
  doc              TEXT,
  name             TEXT,
  object           TEXT,
  kind             TEXT,
  modality         TEXT,
  status           TEXT,
  signed_at        TEXT,
  start_at         TEXT,
  end_at           TEXT,
  original_cents   INTEGER,
  current_cents    INTEGER,
  collection_id    INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX state_contract_doc ON state_contract(doc);
CREATE INDEX state_contract_signed ON state_contract(signed_at);
