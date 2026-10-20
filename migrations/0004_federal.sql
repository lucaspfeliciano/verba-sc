-- Deputados federais e senadores por SC: cota para o exercício da atividade
-- parlamentar (CEAP na Câmara, CEAPS no Senado).

-- Parlamentar como a Casa o identifica (ideCadastro na Câmara, CodigoParlamentar no Senado).
CREATE TABLE fed_member (
  house       TEXT NOT NULL,          -- camara | senado
  member_id   TEXT NOT NULL,
  name        TEXT NOT NULL,          -- nome parlamentar
  full_name   TEXT,
  cpf         TEXT,                   -- só Câmara; usado para ligar ao TSE, nunca exibido
  party       TEXT,
  role        TEXT,                   -- Senado: Titular, 1º Suplente, 2º Suplente
  PRIMARY KEY (house, member_id)
);

CREATE TABLE fed_expense (
  id               INTEGER PRIMARY KEY,
  house            TEXT NOT NULL,
  member_id        TEXT NOT NULL,
  year             INTEGER NOT NULL,
  month            INTEGER,
  issued_at        TEXT,
  category         TEXT NOT NULL,
  supplier_doc     TEXT,             -- CNPJ (14) ou CPF (11), só dígitos
  supplier_name    TEXT,
  supplier_norm    TEXT,
  doc_number       TEXT,             -- número da nota/fatura
  amount_cents     INTEGER NOT NULL,
  document_url     TEXT,             -- Câmara: nota fiscal digitalizada
  detail           TEXT,             -- Senado: detalhamento; Câmara: passageiro e trecho
  collection_id    INTEGER NOT NULL REFERENCES collection(id)
);
CREATE INDEX fed_expense_member ON fed_expense(house, member_id, year);
CREATE INDEX fed_expense_doc ON fed_expense(supplier_doc);
CREATE INDEX fed_expense_year ON fed_expense(house, year, category);

-- Estatística nacional por categoria e ano (todos os 513 deputados / 81 senadores),
-- para comparar quem é de SC com o país inteiro.
CREATE TABLE fed_category_stat (
  house         TEXT NOT NULL,
  year          INTEGER NOT NULL,
  category      TEXT NOT NULL,
  members       INTEGER NOT NULL,
  median_cents  INTEGER NOT NULL,
  p90_cents     INTEGER NOT NULL,
  PRIMARY KEY (house, year, category)
);
