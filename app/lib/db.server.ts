// Consultas de leitura usadas pelas páginas. O site nunca escreve no banco.
import { env } from "cloudflare:workers";

const db = () => env.DB;

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const { results } = await db().prepare(sql).bind(...params).all<T>();
  return results;
}
export async function one<T>(sql: string, ...params: unknown[]): Promise<T | null> {
  return db().prepare(sql).bind(...params).first<T>();
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface Politician {
  id: string;
  slug: string;
  name: string;
  ballot_name: string;
  name_norm: string;
  gender: string | null;
}
export interface Candidacy {
  sq_candidato: string;
  year: number;
  office: string;
  unit: string;
  party: string | null;
  number: string | null;
  ballot_name: string;
  result: string | null;
  elected: number;
  campaign_cnpj: string | null;
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------

export async function overview() {
  const [alesc, pmf, cmf, staff, signals, updated, fed] = await Promise.all([
    one<{ year: number; cents: number; accounts: number }>(
      `SELECT year, sum(amount_cents) AS cents, count(DISTINCT account) AS accounts
         FROM alesc_expense WHERE year = (SELECT max(year) FROM alesc_expense) GROUP BY year`,
    ),
    one<{ year: number; cents: number; payees: number }>(
      `SELECT year, sum(paid_cents) AS cents, count(*) AS payees FROM epublica_payee_year
        WHERE entity = 2002 AND year = (SELECT max(year) FROM epublica_payee_year WHERE entity = 2002) GROUP BY year`,
    ),
    one<{ year: number; cents: number }>(
      `SELECT year, sum(paid_cents) AS cents FROM epublica_payee_year
        WHERE entity = 1018 AND year = (SELECT max(year) FROM epublica_payee_year WHERE entity = 1018) GROUP BY year`,
    ),
    one<{ ref_month: string; cents: number; people: number }>(
      `SELECT ref_month, sum(gross_cents) AS cents, count(*) AS people FROM cmf_staff
        WHERE office LIKE 'Gabinete %' AND office NOT LIKE 'Gabinete da Presid%'
          AND ref_month = (SELECT max(ref_month) FROM cmf_staff) GROUP BY ref_month`,
    ),
    all<{ severity: string; n: number }>("SELECT severity, count(*) AS n FROM signal GROUP BY severity"),
    one<{ at: string }>("SELECT max(fetched_at) AS at FROM collection WHERE source <> 'tse'"),
    one<{ year: number; cents: number; members: number }>(
      `SELECT year, sum(amount_cents) AS cents, count(DISTINCT house || member_id) AS members FROM fed_expense
        WHERE year = (SELECT max(year) FROM fed_expense WHERE house = 'camara') GROUP BY year`,
    ),
  ]);
  return { alesc, pmf, cmf, staff, signals, updated: updated?.at ?? null, fed };
}

export async function topSignals(limit = 6) {
  return all<SignalRow>(
    `SELECT s.*, p.slug, p.ballot_name FROM signal s LEFT JOIN politician p ON p.id = s.politician_id
      ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, s.amount_cents DESC LIMIT ?1`,
    limit,
  );
}

// ---------------------------------------------------------------------------
// ALESC
// ---------------------------------------------------------------------------

export async function alescYears(): Promise<number[]> {
  return (await all<{ year: number }>("SELECT DISTINCT year FROM alesc_expense ORDER BY year DESC")).map((r) => r.year);
}

export async function alescRanking(year: number) {
  const rows = await all<{
    account: string;
    cents: number;
    n: number;
    slug: string | null;
    party: string | null;
  }>(
    `SELECT x.account, sum(x.amount_cents) AS cents, count(*) AS n, p.slug,
            (SELECT c.party FROM candidacy c WHERE c.politician_id = p.id ORDER BY c.year DESC LIMIT 1) AS party
       FROM alesc_expense x
       LEFT JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
       LEFT JOIN politician p ON p.id = l.politician_id
      WHERE x.year = ?1
      GROUP BY x.account ORDER BY cents DESC`,
    year,
  );
  const cats = await all<{ account: string; category: string; cents: number }>(
    `SELECT account, category, sum(amount_cents) AS cents FROM alesc_expense WHERE year = ?1
      GROUP BY account, category ORDER BY cents DESC`,
    year,
  );
  const byAccount = new Map<string, { category: string; cents: number }[]>();
  for (const c of cats) {
    if (!byAccount.has(c.account)) byAccount.set(c.account, []);
    byAccount.get(c.account)!.push(c);
  }
  return rows.map((r) => ({ ...r, categories: byAccount.get(r.account) ?? [] }));
}

export async function alescCategories(year: number) {
  return all<{ category: string; cents: number; accounts: number }>(
    `SELECT category, sum(amount_cents) AS cents, count(DISTINCT account) AS accounts
       FROM alesc_expense WHERE year = ?1 GROUP BY category ORDER BY cents DESC`,
    year,
  );
}

/** Detalhe de uma conta (gabinete) da ALESC; `accounts` pode ter mais de um nome para a mesma pessoa. */
export async function alescAccountDetail(accounts: string[], year: number | null) {
  if (accounts.length === 0) return null;
  const ph = accounts.map((_, i) => `?${i + 1}`).join(", ");
  const yearly = await all<{ year: number; cents: number }>(
    `SELECT year, sum(amount_cents) AS cents FROM alesc_expense WHERE account IN (${ph}) GROUP BY year ORDER BY year`,
    ...accounts,
  );
  if (yearly.length === 0) return null;
  const y = year && yearly.some((r) => r.year === year) ? year : yearly[yearly.length - 1].year;
  const n = accounts.length + 1;
  const [categories, monthly, payees, rows] = await Promise.all([
    all<{ category: string; cents: number; peer_median: number | null }>(
      `SELECT category, sum(amount_cents) AS cents FROM alesc_expense
        WHERE account IN (${ph}) AND year = ?${n} GROUP BY category ORDER BY cents DESC`,
      ...accounts,
      y,
    ),
    all<{ month: string; cents: number }>(
      `SELECT substr(ref_date, 1, 7) AS month, sum(amount_cents) AS cents FROM alesc_expense
        WHERE account IN (${ph}) AND year = ?${n} GROUP BY month ORDER BY month`,
      ...accounts,
      y,
    ),
    all<{ payee: string; payee_norm: string; cents: number; n: number; categories: string; doc: string | null }>(
      `SELECT max(x.payee) AS payee, x.payee_norm, sum(x.amount_cents) AS cents, count(*) AS n,
              group_concat(DISTINCT x.category) AS categories, max(d.doc) AS doc
         FROM alesc_expense x LEFT JOIN alesc_payee_doc d ON d.payee_norm = x.payee_norm
        WHERE x.account IN (${ph}) AND x.year = ?${n} AND x.payee_norm IS NOT NULL
        GROUP BY x.payee_norm ORDER BY cents DESC LIMIT 15`,
      ...accounts,
      y,
    ),
    all<{ ref_date: string; category: string; description: string | null; payee: string | null; route: string | null; amount_cents: number; r2_key: string | null }>(
      `SELECT x.ref_date, x.category, x.description, x.payee, x.route, x.amount_cents, c.r2_key
         FROM alesc_expense x JOIN collection c ON c.id = x.collection_id
        WHERE x.account IN (${ph}) AND x.year = ?${n} ORDER BY x.amount_cents DESC LIMIT 15`,
      ...accounts,
      y,
    ),
  ]);
  // Mediana dos gabinetes por categoria no mesmo ano, para comparação.
  const peers = await all<{ category: string; cents: number }>(
    `SELECT category, sum(amount_cents) AS cents FROM alesc_expense WHERE year = ?1 GROUP BY category, account`,
    y,
  );
  const medians = new Map<string, number>();
  const grouped = new Map<string, number[]>();
  for (const p of peers) {
    if (!grouped.has(p.category)) grouped.set(p.category, []);
    grouped.get(p.category)!.push(p.cents);
  }
  for (const [k, v] of grouped) {
    v.sort((a, b) => a - b);
    medians.set(k, v[Math.floor(v.length / 2)]);
  }
  return {
    year: y,
    yearly,
    categories: categories.map((c) => ({ ...c, peer_median: medians.get(c.category) ?? null })),
    monthly,
    payees,
    rows,
  };
}

// ---------------------------------------------------------------------------
// ALESC: pagamentos a credores (quem recebe de fato)
// ---------------------------------------------------------------------------

export interface PaymentGroup {
  natureza: string;
  subelemento: string | null;
  doc: string | null;
  doc_fmt: string | null;
  credor: string;
  credor_norm: string;
  cents: number;
  n: number;
}

/** O ano tem a atividade parlamentar separada (subação 15915)? Senão, a natureza mistura outras compras. */
async function gabineteScoped(year: number): Promise<boolean> {
  const r = await one<{ n: number }>("SELECT count(*) AS n FROM alesc_payment WHERE year = ?1 AND subacao = '15915'", year);
  return (r?.n ?? 0) > 0;
}

/** Credores pagos pela ALESC nas naturezas ligadas às verbas de gabinete, num ano. */
export async function alescRecipients(year: number, naturezas: string[]) {
  if (naturezas.length === 0) return { scoped: false, rows: [] as PaymentGroup[] };
  const scoped = await gabineteScoped(year);
  const ph = naturezas.map((_, i) => `?${i + 2}`).join(", ");
  const rows = await all<PaymentGroup>(
    `SELECT natureza, max(subelemento) AS subelemento, doc, max(doc_fmt) AS doc_fmt, max(credor) AS credor, credor_norm,
            sum(paid_cents) AS cents, count(*) AS n
       FROM alesc_payment
      WHERE year = ?1 AND natureza IN (${ph}) ${scoped ? "AND subacao = '15915'" : ""}
      GROUP BY natureza, credor_norm, doc ORDER BY cents DESC`,
    year,
    ...naturezas,
  );
  return { scoped, rows };
}

/** Pagamentos da ALESC cujo complemento foi ligado a este deputado (a partir de 2024). */
export async function gabinetePayments(politicianId: string, year: number) {
  return all<PaymentGroup & { liquid_docs: string }>(
    `SELECT p.natureza, max(p.subelemento) AS subelemento, p.doc, max(p.doc_fmt) AS doc_fmt, max(p.credor) AS credor,
            p.credor_norm, sum(p.paid_cents) AS cents, count(*) AS n, group_concat(DISTINCT p.liquid_doc) AS liquid_docs
       FROM alesc_payment p JOIN mandate_link l ON l.source = 'alesc_comp' AND l.alias = p.complemento
      WHERE l.politician_id = ?1 AND p.year = ?2
      GROUP BY p.natureza, p.credor_norm, p.doc ORDER BY cents DESC`,
    politicianId,
    year,
  );
}

// ---------------------------------------------------------------------------
// Congresso: cota parlamentar (Câmara e Senado)
// ---------------------------------------------------------------------------

export type House = "camara" | "senado";

export async function fedYears(house: House): Promise<number[]> {
  return (await all<{ year: number }>("SELECT DISTINCT year FROM fed_expense WHERE house = ?1 ORDER BY year DESC", house)).map((r) => r.year);
}

export async function fedRanking(house: House, year: number) {
  const rows = await all<{ member_id: string; name: string; party: string | null; role: string | null; slug: string | null; cents: number; n: number }>(
    `SELECT e.member_id, m.name, m.party, m.role, p.slug, sum(e.amount_cents) AS cents, count(*) AS n
       FROM fed_expense e JOIN fed_member m ON m.house = e.house AND m.member_id = e.member_id
       LEFT JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
       LEFT JOIN politician p ON p.id = l.politician_id
      WHERE e.house = ?1 AND e.year = ?2
      GROUP BY e.member_id ORDER BY cents DESC`,
    house,
    year,
  );
  const cats = await all<{ member_id: string; category: string; cents: number; median_cents: number | null }>(
    `SELECT e.member_id, e.category, sum(e.amount_cents) AS cents, max(s.median_cents) AS median_cents
       FROM fed_expense e LEFT JOIN fed_category_stat s ON s.house = e.house AND s.year = e.year AND s.category = e.category
      WHERE e.house = ?1 AND e.year = ?2 GROUP BY e.member_id, e.category ORDER BY cents DESC`,
    house,
    year,
  );
  const byMember = new Map<string, typeof cats>();
  for (const c of cats) {
    if (!byMember.has(c.member_id)) byMember.set(c.member_id, []);
    byMember.get(c.member_id)!.push(c);
  }
  return rows.map((r) => ({ ...r, categories: byMember.get(r.member_id) ?? [] }));
}

export async function fedCategories(house: House, year: number) {
  return all<{ category: string; cents: number; members: number; median_cents: number | null }>(
    `SELECT e.category, sum(e.amount_cents) AS cents, count(DISTINCT e.member_id) AS members, max(s.median_cents) AS median_cents
       FROM fed_expense e LEFT JOIN fed_category_stat s ON s.house = e.house AND s.year = e.year AND s.category = e.category
      WHERE e.house = ?1 AND e.year = ?2 GROUP BY e.category ORDER BY cents DESC`,
    house,
    year,
  );
}

/** Detalhe da cota de um parlamentar (pode ter mais de um código, ex.: titular e suplente). */
export async function fedDetail(house: House, members: string[], year: number | null) {
  if (members.length === 0) return null;
  const ph = members.map((_, i) => `?${i + 2}`).join(", ");
  const yearly = await all<{ year: number; cents: number }>(
    `SELECT year, sum(amount_cents) AS cents FROM fed_expense WHERE house = ?1 AND member_id IN (${ph}) GROUP BY year ORDER BY year`,
    house,
    ...members,
  );
  if (yearly.length === 0) return null;
  const y = year && yearly.some((r) => r.year === year) ? year : yearly[yearly.length - 1].year;
  const n = members.length + 2;
  const [categories, suppliers, rows, info] = await Promise.all([
    all<{ category: string; cents: number; median_cents: number | null; p90_cents: number | null; peers: number | null }>(
      `SELECT e.category, sum(e.amount_cents) AS cents, max(s.median_cents) AS median_cents, max(s.p90_cents) AS p90_cents, max(s.members) AS peers
         FROM fed_expense e LEFT JOIN fed_category_stat s ON s.house = e.house AND s.year = e.year AND s.category = e.category
        WHERE e.house = ?1 AND e.member_id IN (${ph}) AND e.year = ?${n} GROUP BY e.category ORDER BY cents DESC`,
      house,
      ...members,
      y,
    ),
    all<{ supplier_doc: string | null; supplier_name: string | null; cents: number; n: number; categories: string }>(
      `SELECT supplier_doc, max(supplier_name) AS supplier_name, sum(amount_cents) AS cents, count(*) AS n, group_concat(DISTINCT category) AS categories
         FROM fed_expense WHERE house = ?1 AND member_id IN (${ph}) AND year = ?${n}
        GROUP BY coalesce(supplier_doc, supplier_norm) ORDER BY cents DESC LIMIT 15`,
      house,
      ...members,
      y,
    ),
    all<{ issued_at: string | null; category: string; supplier_doc: string | null; supplier_name: string | null; amount_cents: number; document_url: string | null; detail: string | null; doc_number: string | null }>(
      `SELECT issued_at, category, supplier_doc, supplier_name, amount_cents, document_url, detail, doc_number
         FROM fed_expense WHERE house = ?1 AND member_id IN (${ph}) AND year = ?${n} ORDER BY amount_cents DESC LIMIT 20`,
      house,
      ...members,
      y,
    ),
    one<{ name: string; party: string | null; role: string | null }>(
      `SELECT name, party, role FROM fed_member WHERE house = ?1 AND member_id IN (${ph}) LIMIT 1`,
      house,
      ...members,
    ),
  ]);
  return { house, year: y, yearly, categories, suppliers, rows, info };
}

/** O que um CNPJ recebeu da cota parlamentar de deputados federais e senadores de SC. */
export async function fedBySupplier(doc: string) {
  return all<{ house: House; member_id: string; name: string; slug: string | null; year: number; category: string; cents: number; n: number }>(
    `SELECT e.house, e.member_id, m.name, p.slug, e.year, max(e.category) AS category, sum(e.amount_cents) AS cents, count(*) AS n
       FROM fed_expense e JOIN fed_member m ON m.house = e.house AND m.member_id = e.member_id
       LEFT JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
       LEFT JOIN politician p ON p.id = l.politician_id
      WHERE e.supplier_doc = ?1 GROUP BY e.house, e.member_id, e.year ORDER BY e.year DESC, cents DESC`,
    doc,
  );
}

// ---------------------------------------------------------------------------
// Emendas parlamentares federais
// ---------------------------------------------------------------------------

// Executado = pago no ano da emenda + restos a pagar pagos nos anos seguintes.
const EXEC = "(e.paid_cents + e.rp_paid_cents)";

export async function emendaYears(): Promise<number[]> {
  return (await all<{ year: number }>("SELECT DISTINCT year FROM emenda ORDER BY year DESC")).map((r) => r.year);
}

function yearFilter(year: number | null, alias = "e") {
  return year ? `AND ${alias}.year = ${Number(year)}` : "";
}

export async function emendaOverview(year: number | null) {
  const [authors, municipios, funcoes, totals] = await Promise.all([
    all<{ author_name: string; slug: string | null; party: string | null; n: number; committed: number; executed: number }>(
      `SELECT max(e.author_name) AS author_name, p.slug,
              (SELECT c.party FROM candidacy c WHERE c.politician_id = p.id ORDER BY c.year DESC LIMIT 1) AS party,
              count(*) AS n, sum(e.committed_cents) AS committed, sum(${EXEC}) AS executed
         FROM emenda e
         LEFT JOIN mandate_link l ON l.source = 'emenda' AND l.alias = e.author_norm
         LEFT JOIN politician p ON p.id = l.politician_id
        WHERE 1 = 1 ${yearFilter(year)}
        GROUP BY e.author_norm ORDER BY executed DESC`,
    ),
    all<{ municipio: string; uf: string | null; n: number; executed: number; authors: number }>(
      `SELECT e.municipio, max(e.uf) AS uf, count(*) AS n, sum(${EXEC}) AS executed, count(DISTINCT e.author_norm) AS authors
         FROM emenda e WHERE e.municipio IS NOT NULL ${yearFilter(year)}
        GROUP BY e.municipio_ibge, e.municipio ORDER BY executed DESC LIMIT 25`,
    ),
    all<{ funcao: string; executed: number; n: number }>(
      `SELECT coalesce(e.funcao, 'Não informada') AS funcao, sum(${EXEC}) AS executed, count(*) AS n
         FROM emenda e WHERE 1 = 1 ${yearFilter(year)} GROUP BY funcao ORDER BY executed DESC`,
    ),
    one<{ n: number; committed: number; executed: number }>(
      `SELECT count(*) AS n, sum(e.committed_cents) AS committed, sum(${EXEC}) AS executed FROM emenda e WHERE 1 = 1 ${yearFilter(year)}`,
    ),
  ]);
  return { authors, municipios, funcoes, totals };
}

export async function emendasForPolitician(politicianId: string) {
  const authors = (
    await all<{ alias: string }>("SELECT alias FROM mandate_link WHERE source = 'emenda' AND politician_id = ?1", politicianId)
  ).map((r) => r.alias);
  if (authors.length === 0) return null;
  const ph = authors.map((_, i) => `?${i + 1}`).join(", ");
  const [yearly, municipios, favorecidos, convenios] = await Promise.all([
    all<{ year: number; n: number; committed: number; executed: number }>(
      `SELECT e.year, count(*) AS n, sum(e.committed_cents) AS committed, sum(${EXEC}) AS executed
         FROM emenda e WHERE e.author_norm IN (${ph}) GROUP BY e.year ORDER BY e.year`,
      ...authors,
    ),
    all<{ municipio: string; uf: string | null; n: number; executed: number }>(
      `SELECT coalesce(e.municipio, e.locality) AS municipio, max(e.uf) AS uf, count(*) AS n, sum(${EXEC}) AS executed
         FROM emenda e WHERE e.author_norm IN (${ph}) GROUP BY coalesce(e.municipio_ibge, e.locality) ORDER BY executed DESC LIMIT 15`,
      ...authors,
    ),
    all<{ doc: string | null; name: string | null; natureza: string | null; kind: string | null; municipio: string | null; cents: number; n: number }>(
      `SELECT doc, max(name) AS name, max(natureza) AS natureza, max(kind) AS kind, max(municipio) AS municipio,
              sum(amount_cents) AS cents, count(DISTINCT code) AS n
         FROM emenda_favorecido WHERE author_norm IN (${ph}) GROUP BY coalesce(doc, name_norm) ORDER BY cents DESC LIMIT 15`,
      ...authors,
    ),
    all<{ code: string; convenente: string | null; objeto: string | null; amount_cents: number; published_at: string | null; locality: string | null }>(
      `SELECT c.code, c.convenente, c.objeto, c.amount_cents, c.published_at, c.locality
         FROM emenda_convenio c JOIN emenda e ON e.code = c.code
        WHERE e.author_norm IN (${ph}) ORDER BY c.amount_cents DESC LIMIT 15`,
      ...authors,
    ),
  ]);
  return { yearly, municipios, favorecidos, convenios };
}

export async function emendasByDoc(doc: string) {
  return all<{ author_name: string; slug: string | null; year: string; cents: number; n: number; natureza: string | null; favorecido: string | null }>(
    `SELECT max(coalesce(e.author_name, f.author_norm)) AS author_name, max(f.name) AS favorecido, p.slug, substr(f.year_month, 1, 4) AS year,
            sum(f.amount_cents) AS cents, count(DISTINCT f.code) AS n, max(f.natureza) AS natureza
       FROM emenda_favorecido f
       LEFT JOIN emenda e ON e.code = f.code
       LEFT JOIN mandate_link l ON l.source = 'emenda' AND l.alias = f.author_norm
       LEFT JOIN politician p ON p.id = l.politician_id
      WHERE f.doc = ?1 GROUP BY f.author_norm, year ORDER BY year DESC, cents DESC`,
    doc,
  );
}

/** Evidências da regra emenda_campanha. */
export async function emendaCampaignEvidence(s: SignalFull) {
  const [payments, convenios, campaignExpense, campaignReceipt] = await Promise.all([
    all<{ code: string; year_month: string | null; amount_cents: number; acao: string | null; municipio: string | null; funcao: string | null }>(
      `SELECT f.code, f.year_month, f.amount_cents, e.acao, coalesce(e.municipio, e.locality) AS municipio, e.funcao
         FROM emenda_favorecido f JOIN mandate_link l ON l.source = 'emenda' AND l.alias = f.author_norm
         LEFT JOIN emenda e ON e.code = f.code
        WHERE l.politician_id = ?1 AND f.doc = ?2 ORDER BY f.year_month`,
      s.politician_id,
      s.doc,
    ),
    all<{ code: string; convenente: string | null; objeto: string | null; amount_cents: number; published_at: string | null }>(
      `SELECT c.code, c.convenente, c.objeto, c.amount_cents, c.published_at FROM emenda_convenio c
        WHERE c.code IN (SELECT f.code FROM emenda_favorecido f JOIN mandate_link l ON l.source = 'emenda' AND l.alias = f.author_norm
                          WHERE l.politician_id = ?1 AND f.doc = ?2)`,
      s.politician_id,
      s.doc,
    ),
    all<{ year: number; date: string | null; description: string | null; category: string | null; amount_cents: number }>(
      `SELECT c.year, e.spent_at AS date, e.description, e.category, e.amount_cents FROM campaign_expense e
         JOIN candidacy c ON c.sq_candidato = e.sq_candidato WHERE c.politician_id = ?1 AND e.supplier_doc = ?2 ORDER BY e.spent_at`,
      s.politician_id,
      s.doc,
    ),
    all<{ year: number; date: string | null; description: string | null; category: string | null; amount_cents: number }>(
      `SELECT c.year, r.received_at AS date, r.kind AS description, r.origin AS category, r.amount_cents FROM campaign_receipt r
         JOIN candidacy c ON c.sq_candidato = r.sq_candidato WHERE c.politician_id = ?1 AND r.donor_doc = ?2 ORDER BY r.received_at`,
      s.politician_id,
      s.doc,
    ),
  ]);
  return {
    payments,
    convenios,
    campaign: [
      ...campaignExpense.map((x) => ({ ...x, rel: "Prestou serviço" })),
      ...campaignReceipt.map((x) => ({ ...x, rel: "Doou" })),
    ],
  };
}

// ---------------------------------------------------------------------------
// Governo do Estado de SC (Poder Executivo)
// ---------------------------------------------------------------------------

export const FOCUS_ORGAO_SQL =
  "(orgao LIKE '%Gabinete Governador%' OR orgao LIKE '%Vice-Governador%' OR orgao LIKE 'Secretaria de Estado da Comunica%')";

export async function stateYears(): Promise<number[]> {
  return (await all<{ year: number }>("SELECT DISTINCT year FROM state_orgao_year ORDER BY year DESC")).map((r) => r.year);
}

export async function governors() {
  return all<{ slug: string; ballot_name: string; office: string; year: number; party: string | null; politician_id: string; cpf: string | null }>(
    `SELECT p.slug, c.ballot_name, c.office, c.year, c.party, p.id AS politician_id, p.cpf
       FROM candidacy c JOIN politician p ON p.id = c.politician_id
      WHERE c.office IN ('GOVERNADOR', 'VICE-GOVERNADOR') AND c.elected = 1 ORDER BY c.year DESC, c.office`,
  );
}

export async function stateOverview(year: number) {
  const [orgaos, payees, totals, focus, contracts] = await Promise.all([
    all<{ orgao: string; cents: number }>(
      "SELECT orgao, sum(committed_cents) AS cents FROM state_orgao_year WHERE year = ?1 GROUP BY orgao ORDER BY cents DESC",
      year,
    ),
    all<{ doc: string; name: string; cents: number; orgaos: number }>(
      `SELECT doc, max(name) AS name, sum(committed_cents) AS cents, count(DISTINCT orgao) AS orgaos
         FROM state_payee_year WHERE year = ?1 GROUP BY doc ORDER BY cents DESC LIMIT 25`,
      year,
    ),
    one<{ cents: number; payees: number }>(
      "SELECT sum(committed_cents) AS cents, count(DISTINCT doc) AS payees FROM state_payee_year WHERE year = ?1",
      year,
    ),
    all<{ orgao: string; cents: number }>(
      `SELECT orgao, sum(committed_cents) AS cents FROM state_orgao_year WHERE year = ?1 AND ${FOCUS_ORGAO_SQL} GROUP BY orgao ORDER BY cents DESC`,
      year,
    ),
    all<{ number: string | null; doc: string | null; name: string | null; object: string | null; ug: string | null; modality: string | null; signed_at: string | null; current_cents: number }>(
      `SELECT number, doc, name, object, ug, modality, signed_at, current_cents FROM state_contract
        WHERE substr(signed_at, 1, 4) = ?1 ORDER BY current_cents DESC LIMIT 15`,
      String(year),
    ),
  ]);
  return { orgaos, payees, totals, focus, contracts };
}

/** Gabinete do Governador, Vice-Governadoria e Comunicação: para onde vai o dinheiro. */
export async function stateFocusDetail(year: number, orgao: string) {
  const [payees, elements, biggest] = await Promise.all([
    all<{ doc: string; name: string; cents: number; n: number }>(
      `SELECT doc, max(name) AS name, sum(committed_cents) AS cents, sum(n) AS n FROM state_payee_year
        WHERE year = ?1 AND orgao = ?2 GROUP BY doc ORDER BY cents DESC LIMIT 12`,
      year,
      orgao,
    ),
    all<{ element: string; cents: number }>(
      `SELECT coalesce(element, 'Não informado') AS element, sum(amount_cents) AS cents FROM state_empenho
        WHERE year = ?1 AND orgao = ?2 GROUP BY element HAVING cents > 0 ORDER BY cents DESC LIMIT 10`,
      year,
      orgao,
    ),
    all<{ issued_at: string | null; nota: string | null; history: string | null; modality: string | null; doc: string | null; name: string | null; element: string | null; amount_cents: number }>(
      `SELECT issued_at, nota, history, modality, doc, name, element, amount_cents FROM state_empenho
        WHERE year = ?1 AND orgao = ?2 AND kind = 'Emissão' ORDER BY amount_cents DESC LIMIT 12`,
      year,
      orgao,
    ),
  ]);
  return { payees, elements, biggest };
}

/** Empenhos em que o credor é o próprio governador ou vice (pelo CPF do TSE). */
export async function stateDirectPayments(cpf: string | null) {
  if (!cpf) return [];
  return all<{ year: number; issued_at: string | null; orgao: string; element: string | null; history: string | null; amount_cents: number }>(
    `SELECT year, issued_at, orgao, element, history, amount_cents FROM state_empenho WHERE doc = ?1 ORDER BY issued_at DESC LIMIT 200`,
    cpf,
  );
}

export async function stateBySupplier(doc: string) {
  const [years, contracts] = await Promise.all([
    all<{ year: number; orgao: string; name: string; cents: number; n: number }>(
      `SELECT year, orgao, max(name) AS name, sum(committed_cents) AS cents, sum(n) AS n FROM state_payee_year
        WHERE doc = ?1 GROUP BY year, orgao ORDER BY year DESC, cents DESC`,
      doc,
    ),
    all<{ number: string | null; name: string | null; object: string | null; ug: string | null; modality: string | null; signed_at: string | null; current_cents: number; status: string | null }>(
      `SELECT number, name, object, ug, modality, signed_at, current_cents, status FROM state_contract
        WHERE doc = ?1 ORDER BY signed_at DESC LIMIT 50`,
      doc,
    ),
  ]);
  return { years, contracts };
}

/** Evidências da regra estado_campanha_contrato. */
export async function stateCampaignEvidence(s: SignalFull, ev: { election: number; role: string }) {
  const doc = s.doc!;
  const [candidacy, lines, history, orgaos, contracts] = await Promise.all([
    one<Candidacy & { receipts: number; expenses: number }>(
      `SELECT c.*,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_receipt r WHERE r.sq_candidato = c.sq_candidato) AS receipts,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_expense e WHERE e.sq_candidato = c.sq_candidato) AS expenses
         FROM candidacy c WHERE c.politician_id = ?1 AND c.year = ?2 AND c.office IN ('GOVERNADOR', 'VICE-GOVERNADOR') LIMIT 1`,
      s.politician_id,
      ev.election,
    ),
    ev.role === "doacao"
      ? all<{ date: string | null; category: string | null; description: string | null; amount_cents: number }>(
          `SELECT r.received_at AS date, r.origin AS category, coalesce(r.kind, r.fund) AS description, r.amount_cents
             FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato
            WHERE c.politician_id = ?1 AND c.year = ?2 AND r.donor_doc = ?3 ORDER BY r.received_at`,
          s.politician_id,
          ev.election,
          doc,
        )
      : all<{ date: string | null; category: string | null; description: string | null; amount_cents: number }>(
          `SELECT e.spent_at AS date, e.category, e.description, e.amount_cents
             FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
            WHERE c.politician_id = ?1 AND c.year = ?2 AND e.supplier_doc = ?3 ORDER BY e.spent_at`,
          s.politician_id,
          ev.election,
          doc,
        ),
    all<{ year: number; cents: number }>(
      "SELECT year, sum(committed_cents) AS cents FROM state_payee_year WHERE doc = ?1 GROUP BY year ORDER BY year",
      doc,
    ),
    all<{ orgao: string; cents: number }>(
      `SELECT orgao, sum(committed_cents) AS cents FROM state_payee_year WHERE doc = ?1 AND year > ?2
        GROUP BY orgao ORDER BY cents DESC`,
      doc,
      ev.election,
    ),
    all<{ number: string | null; object: string | null; ug: string | null; modality: string | null; signed_at: string | null; current_cents: number }>(
      "SELECT number, object, ug, modality, signed_at, current_cents FROM state_contract WHERE doc = ?1 ORDER BY signed_at DESC LIMIT 30",
      doc,
    ),
  ]);
  return { candidacy, lines, history, orgaos, contracts };
}

// ---------------------------------------------------------------------------
// Ciclos de dinheiro
// ---------------------------------------------------------------------------

export async function cycleStats() {
  const r = await one<{ summary: string; finished_at: string }>(
    "SELECT summary, finished_at FROM ingest_run WHERE step = 'ciclos' AND ok = 1 ORDER BY id DESC LIMIT 1",
  );
  if (!r) return null;
  try {
    const j = JSON.parse(r.summary) as Partial<Record<"nodes" | "edges" | "sccs" | "largest_scc" | "cycles_found" | "cycles_over_threshold" | "with_public_money", number>>;
    return {
      nodes: j.nodes ?? 0,
      edges: j.edges ?? 0,
      sccs: j.sccs ?? 0,
      largest_scc: j.largest_scc ?? 0,
      cycles_found: j.cycles_found ?? 0,
      cycles_over_threshold: j.cycles_over_threshold ?? 0,
      with_public_money: j.with_public_money ?? 0,
      finished_at: r.finished_at,
    };
  } catch {
    return null;
  }
}

export async function cycles(opts: { severity?: string; publico?: boolean; todos?: boolean; slug?: string; page: number }) {
  const where = ["s.rule = 'ciclo_dinheiro'"];
  const params: unknown[] = [];
  if (opts.severity) {
    params.push(opts.severity);
    where.push(`s.severity = ?${params.length}`);
  } else if (!opts.todos) where.push("s.severity <> 'low'");
  if (opts.publico) where.push("json_extract(s.evidence, '$.has_public') = 1");
  if (opts.slug) {
    params.push(`%"slug":"${opts.slug.replace(/[^a-z0-9-]/g, "")}"%`);
    where.push(`s.evidence LIKE ?${params.length}`);
  }
  const w = where.join(" AND ");
  const [total, rows, counts] = await Promise.all([
    one<{ n: number }>(`SELECT count(*) AS n FROM signal s WHERE ${w}`, ...params),
    all<{ key: string; severity: string; title: string; detail: string; amount_cents: number; evidence: string }>(
      `SELECT s.key, s.severity, s.title, s.detail, s.amount_cents, s.evidence FROM signal s WHERE ${w}
        ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, s.amount_cents DESC
        LIMIT 24 OFFSET ${(opts.page - 1) * 24}`,
      ...params,
    ),
    all<{ severity: string; n: number; publico: number }>(
      `SELECT severity, count(*) AS n, sum(json_extract(evidence, '$.has_public') = 1) AS publico
         FROM signal WHERE rule = 'ciclo_dinheiro' GROUP BY severity`,
    ),
  ]);
  return { total: total?.n ?? 0, rows, counts };
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

export async function politicianBySlug(slug: string) {
  const p = await one<Politician>("SELECT id, slug, name, ballot_name, name_norm, gender FROM politician WHERE slug = ?1", slug);
  if (!p) return null;
  const [candidacies, links] = await Promise.all([
    all<Candidacy & { receipts: number; expenses: number; assets: number }>(
      `SELECT c.*,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_receipt r WHERE r.sq_candidato = c.sq_candidato) AS receipts,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_expense e WHERE e.sq_candidato = c.sq_candidato) AS expenses,
              (SELECT coalesce(sum(amount_cents), 0) FROM declared_asset a WHERE a.sq_candidato = c.sq_candidato) AS assets
         FROM candidacy c WHERE c.politician_id = ?1 ORDER BY c.year DESC`,
      p.id,
    ),
    all<{ source: string; alias: string; method: string }>("SELECT source, alias, method FROM mandate_link WHERE politician_id = ?1", p.id),
  ]);
  return { politician: p, candidacies, links };
}

export async function campaignDetail(sq: string) {
  const [donors, suppliers, assets] = await Promise.all([
    all<{ donor_doc: string | null; donor_name: string | null; origin: string | null; cents: number }>(
      `SELECT donor_doc, max(donor_name) AS donor_name, max(origin) AS origin, sum(amount_cents) AS cents
         FROM campaign_receipt WHERE sq_candidato = ?1 GROUP BY coalesce(donor_doc, donor_name) ORDER BY cents DESC LIMIT 12`,
      sq,
    ),
    all<{ supplier_doc: string | null; supplier_name: string | null; category: string | null; cents: number }>(
      `SELECT supplier_doc, max(supplier_name) AS supplier_name, max(category) AS category, sum(amount_cents) AS cents
         FROM campaign_expense WHERE sq_candidato = ?1 GROUP BY coalesce(supplier_doc, supplier_name) ORDER BY cents DESC LIMIT 12`,
      sq,
    ),
    all<{ kind: string | null; description: string | null; amount_cents: number }>(
      "SELECT kind, description, amount_cents FROM declared_asset WHERE sq_candidato = ?1 ORDER BY amount_cents DESC LIMIT 15",
      sq,
    ),
  ]);
  return { donors, suppliers, assets };
}

export async function perDiemsByName(nameNorm: string) {
  return all<{ year: number; issued_at: string; role: string | null; unit: string | null; paid_cents: number; committed_cents: number }>(
    `SELECT year, issued_at, role, unit, paid_cents, committed_cents FROM pmf_per_diem
      WHERE beneficiary_norm = ?1 ORDER BY issued_at DESC LIMIT 100`,
    nameNorm,
  );
}

export async function staffByOffice(office: string) {
  const month = await one<{ m: string }>("SELECT max(ref_month) AS m FROM cmf_staff WHERE office = ?1", office);
  if (!month?.m) return null;
  const staff = await all<{ name: string; role: string | null; admitted_at: string | null; gross_cents: number }>(
    "SELECT name, role, admitted_at, gross_cents FROM cmf_staff WHERE office = ?1 AND ref_month = ?2 ORDER BY gross_cents DESC",
    office,
    month.m,
  );
  return { month: month.m, staff, total: staff.reduce((s, x) => s + x.gross_cents, 0) };
}

// ---------------------------------------------------------------------------
// Câmara
// ---------------------------------------------------------------------------

export async function cmfOffices() {
  const month = await one<{ m: string }>("SELECT max(ref_month) AS m FROM cmf_staff");
  if (!month?.m) return { month: null, offices: [] };
  const offices = await all<{ office: string; people: number; cents: number; slug: string | null; party: string | null }>(
    `SELECT s.office, count(*) AS people, sum(s.gross_cents) AS cents, p.slug,
            (SELECT c.party FROM candidacy c WHERE c.politician_id = p.id ORDER BY c.year DESC LIMIT 1) AS party
       FROM cmf_staff s
       LEFT JOIN mandate_link l ON l.source = 'cmf' AND l.alias = s.office
       LEFT JOIN politician p ON p.id = l.politician_id
      WHERE s.ref_month = ?1 AND s.office LIKE 'Gabinete %' AND s.office NOT LIKE 'Gabinete da Presid%'
      GROUP BY s.office ORDER BY cents DESC`,
    month.m,
  );
  return { month: month.m, offices };
}

export async function electedCouncil(year?: number) {
  const y = year ?? (await one<{ y: number }>("SELECT max(year) AS y FROM candidacy WHERE office = 'VEREADOR'"))?.y;
  return all<{ slug: string; ballot_name: string; party: string | null; receipts: number; expenses: number; result: string }>(
    `SELECT p.slug, c.ballot_name, c.party, c.result,
            (SELECT coalesce(sum(amount_cents), 0) FROM campaign_receipt r WHERE r.sq_candidato = c.sq_candidato) AS receipts,
            (SELECT coalesce(sum(amount_cents), 0) FROM campaign_expense e WHERE e.sq_candidato = c.sq_candidato) AS expenses
       FROM candidacy c JOIN politician p ON p.id = c.politician_id
      WHERE c.office = 'VEREADOR' AND c.year = ?1 AND c.elected = 1 ORDER BY c.ballot_name`,
    y,
  );
}

// ---------------------------------------------------------------------------
// e-Publica (favorecidos)
// ---------------------------------------------------------------------------

export async function payeeYears(entity: number): Promise<number[]> {
  return (await all<{ year: number }>("SELECT DISTINCT year FROM epublica_payee_year WHERE entity = ?1 ORDER BY year DESC", entity)).map(
    (r) => r.year,
  );
}

export async function topPayees(entity: number, year: number, limit = 25) {
  return all<{ doc: string; name: string; paid_cents: number; committed_cents: number; liquidated_cents: number }>(
    `SELECT doc, name, paid_cents, committed_cents, liquidated_cents FROM epublica_payee_year
      WHERE entity = ?1 AND year = ?2 ORDER BY paid_cents DESC LIMIT ?3`,
    entity,
    year,
    limit,
  );
}

export async function payeeTotals(entity: number, year: number) {
  return one<{ paid: number; committed: number; payees: number }>(
    `SELECT sum(paid_cents) AS paid, sum(committed_cents - cancelled_cents) AS committed, count(*) AS payees
       FROM epublica_payee_year WHERE entity = ?1 AND year = ?2`,
    entity,
    year,
  );
}

export async function perDiemTop(year: number) {
  return all<{ beneficiary: string; role: string | null; n: number; cents: number }>(
    `SELECT beneficiary, max(role) AS role, count(*) AS n, sum(paid_cents) AS cents FROM pmf_per_diem
      WHERE year = ?1 GROUP BY beneficiary_norm ORDER BY cents DESC LIMIT 15`,
    year,
  );
}

export async function mayors() {
  return all<{ slug: string; ballot_name: string; office: string; year: number; party: string | null; name_norm: string }>(
    `SELECT p.slug, c.ballot_name, c.office, c.year, c.party, p.name_norm FROM candidacy c JOIN politician p ON p.id = c.politician_id
      WHERE c.office IN ('PREFEITO', 'VICE-PREFEITO') AND c.elected = 1 ORDER BY c.year DESC, c.office`,
  );
}

export async function pncpTop(year: number, limit = 15) {
  return all<{ control_number: string; supplier_doc: string | null; supplier_name: string | null; object: string | null; global_cents: number; signed_at: string | null }>(
    `SELECT control_number, supplier_doc, supplier_name, object, global_cents, signed_at FROM pncp_contract
      WHERE year = ?1 ORDER BY global_cents DESC LIMIT ?2`,
    year,
    limit,
  );
}

// ---------------------------------------------------------------------------
// Fornecedor / documento
// ---------------------------------------------------------------------------

export async function supplierByDoc(doc: string) {
  const [payee, pncp, donations, services] = await Promise.all([
    all<{ entity: number; year: number; name: string; name_norm: string; paid_cents: number; committed_cents: number; r2_key: string | null }>(
      `SELECT p.entity, p.year, p.name, p.name_norm, p.paid_cents, p.committed_cents, c.r2_key
         FROM epublica_payee_year p JOIN collection c ON c.id = p.collection_id WHERE p.doc = ?1 ORDER BY p.year DESC, p.entity`,
      doc,
    ),
    all<{ control_number: string; year: number; object: string | null; global_cents: number; signed_at: string | null; supplier_name: string | null }>(
      "SELECT control_number, year, object, global_cents, signed_at, supplier_name FROM pncp_contract WHERE supplier_doc = ?1 ORDER BY signed_at DESC",
      doc,
    ),
    all<{ slug: string; ballot_name: string; office: string; year: number; elected: number; cents: number; donor_name: string | null }>(
      `SELECT p.slug, c.ballot_name, c.office, c.year, c.elected, sum(r.amount_cents) AS cents, max(r.donor_name) AS donor_name
         FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato JOIN politician p ON p.id = c.politician_id
        WHERE r.donor_doc = ?1 GROUP BY c.sq_candidato ORDER BY c.year DESC, cents DESC`,
      doc,
    ),
    all<{ slug: string; ballot_name: string; office: string; year: number; elected: number; cents: number; supplier_name: string | null }>(
      `SELECT p.slug, c.ballot_name, c.office, c.year, c.elected, sum(e.amount_cents) AS cents, max(e.supplier_name) AS supplier_name
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato JOIN politician p ON p.id = c.politician_id
        WHERE e.supplier_doc = ?1 GROUP BY c.sq_candidato ORDER BY c.year DESC, cents DESC`,
      doc,
    ),
  ]);
  const name =
    payee[0]?.name ?? pncp[0]?.supplier_name ?? services[0]?.supplier_name ?? donations[0]?.donor_name ?? null;
  const nameNorm = payee[0]?.name_norm ?? null;
  const alesc = nameNorm
    ? await all<{ account: string; year: number; cents: number; slug: string | null }>(
        `SELECT x.account, x.year, sum(x.amount_cents) AS cents, p.slug FROM alesc_expense x
           LEFT JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
           LEFT JOIN politician p ON p.id = l.politician_id
          WHERE x.payee_norm = ?1 GROUP BY x.account, x.year ORDER BY x.year DESC, cents DESC LIMIT 50`,
        nameNorm,
      )
    : [];
  const signals = await all<SignalRow>(
    "SELECT s.*, p.slug, p.ballot_name FROM signal s LEFT JOIN politician p ON p.id = s.politician_id WHERE s.doc = ?1",
    doc,
  );
  return { name, payee, pncp, donations, services, alesc, signals };
}

// ---------------------------------------------------------------------------
// Sinais
// ---------------------------------------------------------------------------

export interface SignalRow {
  id: number;
  key: string;
  rule: string;
  severity: string;
  title: string;
  detail: string;
  politician_id: string | null;
  doc: string | null;
  amount_cents: number | null;
  evidence: string;
  slug: string | null;
  ballot_name: string | null;
}

export async function signals(opts: { rule?: string; severity?: string; page: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.rule) {
    params.push(opts.rule);
    where.push(`s.rule = ?${params.length}`);
  }
  if (opts.severity) {
    params.push(opts.severity);
    where.push(`s.severity = ?${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = await one<{ n: number }>(`SELECT count(*) AS n FROM signal s ${w}`, ...params);
  const rows = await all<SignalRow>(
    `SELECT s.*, p.slug, p.ballot_name FROM signal s LEFT JOIN politician p ON p.id = s.politician_id ${w}
      ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, s.amount_cents DESC
      LIMIT 50 OFFSET ${(opts.page - 1) * 50}`,
    ...params,
  );
  const counts = await all<{ rule: string; severity: string; n: number }>(
    "SELECT rule, severity, count(*) AS n FROM signal GROUP BY rule, severity",
  );
  return { total: total?.n ?? 0, rows, counts };
}

// ---------------------------------------------------------------------------
// Detalhe de um sinal
// ---------------------------------------------------------------------------

export interface SignalFull extends SignalRow {
  key: string;
  rule_version: string;
  created_at: string;
  politician_name: string | null;
}

export async function signalByKey(key: string) {
  return one<SignalFull>(
    `SELECT s.*, p.slug, p.ballot_name, p.name AS politician_name FROM signal s
       LEFT JOIN politician p ON p.id = s.politician_id WHERE s.key = ?1`,
    key,
  );
}

/** Evidências da regra campanha_depois_contrato. */
export async function campaignToPayeeEvidence(s: SignalFull, ev: { election: number; role: string; entity: number }) {
  const doc = s.doc!;
  const root = doc.slice(0, 8);
  const [candidacy, lines, history, related, otherCampaigns, contracts, files] = await Promise.all([
    one<Candidacy & { receipts: number; expenses: number }>(
      `SELECT c.*,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_receipt r WHERE r.sq_candidato = c.sq_candidato) AS receipts,
              (SELECT coalesce(sum(amount_cents), 0) FROM campaign_expense e WHERE e.sq_candidato = c.sq_candidato) AS expenses
         FROM candidacy c WHERE c.politician_id = ?1 AND c.year = ?2 ORDER BY c.elected DESC LIMIT 1`,
      s.politician_id,
      ev.election,
    ),
    ev.role === "doacao"
      ? all<{ date: string | null; category: string | null; description: string | null; amount_cents: number; url: string }>(
          `SELECT r.received_at AS date, r.origin AS category, coalesce(r.kind, r.fund) AS description, r.amount_cents, col.url
             FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato
             JOIN collection col ON col.id = r.collection_id
            WHERE c.politician_id = ?1 AND c.year = ?2 AND r.donor_doc = ?3 ORDER BY r.received_at`,
          s.politician_id,
          ev.election,
          doc,
        )
      : all<{ date: string | null; category: string | null; description: string | null; amount_cents: number; url: string }>(
          `SELECT e.spent_at AS date, e.category, e.description, e.amount_cents, col.url
             FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
             JOIN collection col ON col.id = e.collection_id
            WHERE c.politician_id = ?1 AND c.year = ?2 AND e.supplier_doc = ?3 ORDER BY e.spent_at`,
          s.politician_id,
          ev.election,
          doc,
        ),
    all<{ entity: number; year: number; paid_cents: number; committed_cents: number; r2_key: string | null }>(
      `SELECT p.entity, p.year, p.paid_cents, p.committed_cents, c.r2_key
         FROM epublica_payee_year p JOIN collection c ON c.id = p.collection_id
        WHERE p.doc = ?1 ORDER BY p.year`,
      doc,
    ),
    all<{ doc: string; name: string; entity: number; cents: number; y0: number; y1: number }>(
      `SELECT doc, max(name) AS name, entity, sum(paid_cents) AS cents, min(year) AS y0, max(year) AS y1
         FROM epublica_payee_year WHERE substr(doc, 1, 8) = ?1 AND length(doc) = 14 AND doc <> ?2
        GROUP BY doc, entity ORDER BY cents DESC`,
      root,
      doc,
    ),
    all<{ slug: string; ballot_name: string; office: string; year: number; elected: number; cents: number }>(
      `SELECT p.slug, c.ballot_name, c.office, c.year, c.elected, sum(e.amount_cents) AS cents
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato JOIN politician p ON p.id = c.politician_id
        WHERE e.supplier_doc = ?1 GROUP BY c.sq_candidato ORDER BY c.year DESC, cents DESC`,
      doc,
    ),
    all<{ control_number: string; object: string | null; global_cents: number; signed_at: string | null }>(
      "SELECT control_number, object, global_cents, signed_at FROM pncp_contract WHERE supplier_doc = ?1 ORDER BY signed_at",
      doc,
    ),
    one<{ n: number }>("SELECT count(*) AS n FROM epublica_payee_year WHERE doc = ?1", doc),
  ]);
  return { candidacy, lines, history, related, otherCampaigns, contracts, hasFiles: (files?.n ?? 0) > 0 };
}

/** Evidências da regra gabinete_fornecedor_campanha. */
export async function alescPayeeCampaignEvidence(s: SignalFull, ev: { payee_norm: string }) {
  const [alescLines, campaignLines] = await Promise.all([
    all<{ ref_date: string | null; year: number; category: string; description: string | null; account: string; payee: string; amount_cents: number; r2_key: string | null }>(
      `SELECT x.ref_date, x.year, x.category, x.description, x.account, x.payee, x.amount_cents, c.r2_key
         FROM alesc_expense x JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
         JOIN collection c ON c.id = x.collection_id
        WHERE l.politician_id = ?1 AND x.payee_norm = ?2 ORDER BY x.ref_date LIMIT 200`,
      s.politician_id,
      ev.payee_norm,
    ),
    all<{ year: number; spent_at: string | null; category: string | null; description: string | null; supplier_name: string | null; supplier_doc: string | null; amount_cents: number; url: string }>(
      `SELECT c.year, e.spent_at, e.category, e.description, e.supplier_name, e.supplier_doc, e.amount_cents, col.url
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
         JOIN collection col ON col.id = e.collection_id
        WHERE c.politician_id = ?1 AND e.supplier_name_norm = ?2 ORDER BY e.spent_at`,
      s.politician_id,
      ev.payee_norm,
    ),
  ]);
  return { alescLines, campaignLines };
}

/** Evidências da regra gabinete_gasto_atipico. */
export async function alescOutlierEvidence(ev: { year: number; category: string; account: string }) {
  const [peers, lines, history] = await Promise.all([
    all<{ account: string; cents: number; slug: string | null }>(
      `SELECT x.account, sum(x.amount_cents) AS cents, p.slug FROM alesc_expense x
         LEFT JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
         LEFT JOIN politician p ON p.id = l.politician_id
        WHERE x.year = ?1 AND x.category = ?2 GROUP BY x.account ORDER BY cents DESC`,
      ev.year,
      ev.category,
    ),
    all<{ ref_date: string | null; description: string | null; payee: string | null; route: string | null; amount_cents: number; r2_key: string | null }>(
      `SELECT x.ref_date, x.description, x.payee, x.route, x.amount_cents, c.r2_key
         FROM alesc_expense x JOIN collection c ON c.id = x.collection_id
        WHERE x.account = ?1 AND x.year = ?2 AND x.category = ?3 ORDER BY x.amount_cents DESC LIMIT 60`,
      ev.account,
      ev.year,
      ev.category,
    ),
    all<{ year: number; cents: number }>(
      `SELECT year, sum(amount_cents) AS cents FROM alesc_expense
        WHERE account = ?1 AND category = ?2 GROUP BY year ORDER BY year`,
      ev.account,
      ev.category,
    ),
  ]);
  return { peers, lines, history };
}

/** Evidências da regra cota_fornecedor_campanha. */
export async function fedQuotaCampaignEvidence(s: SignalFull, ev: { house: House }) {
  const [quotaLines, campaignLines] = await Promise.all([
    all<{ issued_at: string | null; year: number; category: string; supplier_name: string | null; amount_cents: number; document_url: string | null; detail: string | null }>(
      `SELECT e.issued_at, e.year, e.category, e.supplier_name, e.amount_cents, e.document_url, e.detail
         FROM fed_expense e JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
        WHERE l.politician_id = ?1 AND e.house = ?2 AND e.supplier_doc = ?3 ORDER BY e.issued_at LIMIT 300`,
      s.politician_id,
      ev.house,
      s.doc,
    ),
    all<{ year: number; spent_at: string | null; category: string | null; description: string | null; supplier_name: string | null; supplier_doc: string | null; amount_cents: number; url: string }>(
      `SELECT c.year, e.spent_at, e.category, e.description, e.supplier_name, e.supplier_doc, e.amount_cents, col.url
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
         JOIN collection col ON col.id = e.collection_id
        WHERE c.politician_id = ?1 AND e.supplier_doc = ?2 ORDER BY e.spent_at`,
      s.politician_id,
      s.doc,
    ),
  ]);
  return { quotaLines, campaignLines };
}

/** Evidências da regra cota_gasto_atipico. */
export async function fedOutlierEvidence(ev: { house: House; member_id: string; year: number; category: string }) {
  const [peers, lines, history] = await Promise.all([
    all<{ member_id: string; name: string; slug: string | null; cents: number }>(
      `SELECT e.member_id, m.name, p.slug, sum(e.amount_cents) AS cents
         FROM fed_expense e JOIN fed_member m ON m.house = e.house AND m.member_id = e.member_id
         LEFT JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
         LEFT JOIN politician p ON p.id = l.politician_id
        WHERE e.house = ?1 AND e.year = ?2 AND e.category = ?3 GROUP BY e.member_id ORDER BY cents DESC`,
      ev.house,
      ev.year,
      ev.category,
    ),
    all<{ issued_at: string | null; supplier_doc: string | null; supplier_name: string | null; amount_cents: number; document_url: string | null; detail: string | null }>(
      `SELECT issued_at, supplier_doc, supplier_name, amount_cents, document_url, detail FROM fed_expense
        WHERE house = ?1 AND member_id = ?2 AND year = ?3 AND category = ?4 ORDER BY amount_cents DESC LIMIT 60`,
      ev.house,
      ev.member_id,
      ev.year,
      ev.category,
    ),
    all<{ year: number; cents: number; median_cents: number | null }>(
      `SELECT e.year, sum(e.amount_cents) AS cents, max(s.median_cents) AS median_cents
         FROM fed_expense e LEFT JOIN fed_category_stat s ON s.house = e.house AND s.year = e.year AND s.category = e.category
        WHERE e.house = ?1 AND e.member_id = ?2 AND e.category = ?3 GROUP BY e.year ORDER BY e.year`,
      ev.house,
      ev.member_id,
      ev.category,
    ),
  ]);
  return { peers, lines, history };
}

export async function signalsForPolitician(id: string) {
  return all<SignalRow>(
    `SELECT s.*, NULL AS slug, NULL AS ballot_name FROM signal s WHERE s.politician_id = ?1
      ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, s.amount_cents DESC`,
    id,
  );
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

export async function search(q: string) {
  const d = q.replace(/\D/g, "");
  const term = q.trim().slice(0, 40);
  const like = `%${term.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").trim()}%`;
  const [people, payees, alesc] = await Promise.all([
    all<{ slug: string; ballot_name: string; name: string; offices: string; last_year: number }>(
      `SELECT p.slug, p.ballot_name, p.name, group_concat(DISTINCT c.office) AS offices, max(c.year) AS last_year
         FROM politician p JOIN candidacy c ON c.politician_id = p.id
        WHERE p.name_norm LIKE ?1 OR p.ballot_norm LIKE ?1
        GROUP BY p.id ORDER BY max(c.elected) DESC, last_year DESC LIMIT 25`,
      like,
    ),
    d.length === 14
      ? all<{ doc: string; name: string; cents: number }>(
          "SELECT doc, max(name) AS name, sum(paid_cents) AS cents FROM epublica_payee_year WHERE doc = ?1 GROUP BY doc",
          d,
        )
      : all<{ doc: string; name: string; cents: number }>(
          `SELECT doc, max(name) AS name, sum(paid_cents) AS cents FROM epublica_payee_year
            WHERE name_norm LIKE ?1 AND length(doc) = 14 GROUP BY doc ORDER BY cents DESC LIMIT 25`,
          like,
        ),
    all<{ payee: string; cents: number; accounts: number }>(
      `SELECT max(payee) AS payee, sum(amount_cents) AS cents, count(DISTINCT account) AS accounts FROM alesc_expense
        WHERE payee_norm LIKE ?1 GROUP BY payee_norm ORDER BY cents DESC LIMIT 15`,
      like,
    ),
  ]);
  return { people, payees, alesc, doc: d.length === 14 ? d : null };
}

// ---------------------------------------------------------------------------
// Fontes
// ---------------------------------------------------------------------------

export async function sourcesSummary() {
  const datasets = await all<{ source: string; dataset: string; files: number; rows: number; bytes: number; last: string }>(
    `SELECT source, dataset, count(*) AS files, sum(rows) AS rows, sum(bytes) AS bytes, max(fetched_at) AS last
       FROM collection GROUP BY source, dataset ORDER BY source, dataset`,
  );
  const recent = await all<{ id: number; source: string; dataset: string; scope: string; url: string; fetched_at: string; sha256: string; r2_key: string | null; rows: number; bytes: number }>(
    "SELECT id, source, dataset, scope, url, fetched_at, sha256, r2_key, rows, bytes FROM collection ORDER BY id DESC LIMIT 60",
  );
  const runs = await all<{ step: string; started_at: string; finished_at: string; ok: number; summary: string }>(
    "SELECT step, started_at, finished_at, ok, summary FROM ingest_run ORDER BY id DESC LIMIT 30",
  );
  const unlinked = await all<{ source: string; alias: string }>(
    `SELECT 'alesc' AS source, account AS alias FROM alesc_expense
      WHERE account NOT IN (SELECT alias FROM mandate_link WHERE source = 'alesc') GROUP BY account
     UNION ALL
     SELECT 'cmf', office FROM cmf_staff WHERE office LIKE 'Gabinete %'
      AND office NOT IN (SELECT alias FROM mandate_link WHERE source = 'cmf') GROUP BY office`,
  );
  return { datasets, recent, runs, unlinked };
}
