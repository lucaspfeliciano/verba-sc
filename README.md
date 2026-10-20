# Verba SC

Como deputados estaduais de Santa Catarina, vereadores e a Prefeitura de Florianópolis usam o dinheiro público, cruzado com as contas de campanha declaradas ao TSE. Cada número aponta para o arquivo oficial de onde saiu.

Site: https://verba-sc.lucaspfeliciano.workers.dev

> Os sinais do site são indícios para verificação, não provas nem acusações.

## Fontes

| Fonte | O quê | Como é coletada |
|---|---|---|
| ALESC, Portal da Transparência | Despesas dos gabinetes parlamentares, 2011 em diante | CSV anual, Workflow diário |
| ALESC, Portal da Transparência | Pagamentos a credores (quem recebeu de fato, com CPF/CNPJ), 2011 em diante; sem folha, diárias de servidores e ressarcimentos médicos | CSV anual, Workflow diário |
| Prefeitura de Florianópolis (e-Publica, entidade 2002) | Pagamentos por favorecido e diárias | API JSON do portal, Workflow diário |
| Câmara de Florianópolis (e-Publica, entidade 1018) | Pagamentos por favorecido e comissionados por gabinete | API JSON do portal, Workflow diário |
| Câmara dos Deputados | Cota parlamentar (CEAP) dos deputados federais de SC desde 2015; mediana nacional por categoria | Zip anual nacional, lido em fluxo, Workflow diário |
| Senado Federal | Cota parlamentar (CEAPS) dos senadores e suplentes de SC desde 2015; mediana nacional por categoria | API de dados abertos, Workflow diário |
| Dados Abertos SC (SEF) | Empenhos do Executivo estadual (desde 2021, ~160 MB/ano) e contratos (~74 MB) | CSV lido em fluxo direto da rede, Workflow diário |
| Portal da Transparência (CGU) | Emendas parlamentares de deputados federais, senadores e bancada de SC: destino, favorecidos e convênios | Zip único nacional (~32 MB), lido em fluxo, Workflow diário |
| PNCP | Contratos da Prefeitura (CNPJ 82.892.282/0001-43) | API pública, Workflow diário |
| TSE, dados abertos | Candidaturas, receitas, despesas e bens (deputados estaduais e federais, senadores e suplentes, governador e vice de SC; prefeito, vice e vereador de Florianópolis) | `pipeline/tse_sc.py` (GitHub Action mensal) |

## Arquitetura

```
Cloudflare
├─ Worker (workers/app.ts)
│   ├─ site React Router v8 com SSR (app/)
│   ├─ /admin/ingest    dispara o Workflow (Bearer ADMIN_TOKEN)
│   └─ /bruto/<chave>   cópia exata de cada arquivo oficial (R2)
├─ Workflow verba-sc-ingest (workers/ingest/), todo dia às 06:00 UTC
│   ├─ alesc.ts      CSV dos gabinetes
│   ├─ alesc_payments.ts  pagamentos a credores
│   ├─ epublica.ts   Prefeitura e Câmara
│   ├─ pncp.ts       contratos
│   └─ derive.ts     liga nomes a pessoas do TSE e calcula os sinais
├─ D1 verba-sc       banco (migrations/)
└─ R2 verba-sc-raw   arquivos brutos, chaveados pelo SHA-256

GitHub Action (mensal) → pipeline/tse_sc.py → SQL → D1
```

Os zips do TSE passam de 1 GB e não cabem num Worker (128 MB de memória). O pipeline lê só os CSVs de SC de dentro deles via HTTP Range (`pipeline/httpzip.py`), baixando cerca de 1 a 17 MB por arquivo.

Cada coleta grava uma linha em `collection` com URL, data, SHA-256 e a chave no R2. Toda tabela de dados aponta para a coleta de origem.

## Rodar localmente

Requisitos: Node 20+ e Python 3.10+.

```bash
npm install
npx wrangler d1 migrations apply verba-sc --local
python -I pipeline/tse_sc.py --out dados/tse.sql
npx wrangler d1 execute verba-sc --local --file dados/tse.sql
echo "ADMIN_TOKEN=dev-token-local" > .dev.vars
npm run dev
# em outro terminal, coleta 2025 de todas as fontes:
curl -X POST http://localhost:5173/admin/ingest -H "Authorization: Bearer dev-token-local" \
  -H "Content-Type: application/json" -d '{"years":[2025]}'
```

Parâmetros do `/admin/ingest`:

- `{"backfill": true}`: histórico completo (ALESC desde 2011, e-Publica desde 2017, PNCP desde 2021).
- `{"years": [2024, 2025]}`: só esses anos.
- `{"only": ["alesc", "pmf", "cmf", "pncp", "derive"]}`: só essas etapas.

Para acompanhar uma execução: `GET /admin/ingest/<id>`.

## Deploy

```bash
npx wrangler d1 migrations apply verba-sc --remote
npx wrangler secret put ADMIN_TOKEN
npm run deploy
npx wrangler d1 execute verba-sc --remote --file dados/tse.sql
curl -X POST https://verba-sc.lucaspfeliciano.workers.dev/admin/ingest \
  -H "Authorization: Bearer $ADMIN_TOKEN" -d '{"backfill":true}'
```

## Ligações manuais

Quando um gabinete da ALESC ou da Câmara não é ligado automaticamente a um candidato (aparece em `/fontes`), crie a ligação à mão. Ligações `manual` nunca são apagadas pelo recálculo:

```sql
INSERT INTO mandate_link (source, alias, politician_id, method)
SELECT 'alesc', 'Janice Krasniack', id, 'manual' FROM politician WHERE slug = '<slug>';
```

## Sinais

| Regra | O que aponta |
|---|---|
| `campanha_depois_contrato` | Empresa que prestou serviço ou doou para a campanha de um eleito em Florianópolis e recebeu da Prefeitura ou da Câmara no mandato seguinte (ligação por CNPJ; ignora bancos, concessionárias e fornecedores de mais de 5 campanhas) |
| `gabinete_fornecedor_campanha` | Favorecido da verba de gabinete da ALESC com o mesmo nome de um fornecedor da campanha do mesmo deputado (por nome, porque a ALESC não publica CNPJ) |
| `gabinete_gasto_atipico` | Gasto anual de um gabinete numa categoria pelo menos 3 vezes acima da mediana dos colegas |

## Créditos

A ideia de cruzar dados públicos por documento, com proveniência por arquivo, vem do [EloSys](https://github.com/YuriRDev/elosys). Este código é independente.
