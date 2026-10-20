-- Chave estável por sinal (regra + entidades envolvidas), para que o link
-- /sinais/<chave> continue válido depois de cada recálculo.
ALTER TABLE signal ADD COLUMN key TEXT;
CREATE UNIQUE INDEX signal_key ON signal(key);
