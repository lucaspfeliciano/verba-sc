// Dados derivados: ligação nome-de-gabinete -> pessoa (TSE) e sinais de alerta.
// Tudo aqui é recalculado a cada execução; ligações 'manual' são preservadas.

import { insertJsonRows, normalizeName, nowIso, sha256Hex } from "./util";

const STOP = new Set(["DA", "DE", "DO", "DAS", "DOS", "E", "GABINETE", "VEREADOR", "VEREADORA", "DEPUTADO", "DEPUTADA"]);

function aliasVariants(alias: string): string[] {
  // "Ana Paula da Silva (Paulinha)" -> ["ANA PAULA DA SILVA", "PAULINHA"]
  const out = new Set<string>();
  const paren = /\(([^)]+)\)/.exec(alias);
  out.add(normalizeName(alias.replace(/\([^)]*\)/g, " ").replace(/^gabinete( d[oa])?\s+/i, "")));
  if (paren) out.add(normalizeName(paren[1]));
  return [...out].filter(Boolean);
}

// Títulos que aparecem abreviados ou não no nome de urna ("PE. PEDRO" x "PADRE PEDRO").
const TITLES: Record<string, string> = { PE: "PADRE", SGT: "SARGENTO", DR: "DOUTOR", DRA: "DOUTORA", PROF: "PROFESSOR", PROFA: "PROFESSORA" };
const TITLE_WORDS = new Set([...Object.keys(TITLES), ...Object.values(TITLES), "DELEGADO", "DELEGADA", "CORONEL", "CAPITAO", "PASTOR", "MAJOR", "SARGENTO"]);

/** Variantes para casar um nome cortado (prefixo): com o título por extenso e sem o título. */
function prefixVariants(alias: string): string[] {
  const out = new Set<string>();
  for (const v of aliasVariants(alias)) {
    const t = v.split(" ");
    if (v.length >= 12) out.add(v);
    if (TITLES[t[0]]) out.add([TITLES[t[0]], ...t.slice(1)].join(" "));
    if (TITLE_WORDS.has(t[0]) && t.length > 1) {
      const rest = t.slice(1).join(" ");
      if (rest.length >= 10) out.add(rest);
    }
  }
  return [...out];
}

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); // troca
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1); // inserção/remoção
}

const tokens = (s: string) => s.split(" ").filter((t) => t.length > 1 && !STOP.has(t));

interface Cand {
  politician_id: string;
  name_norm: string;
  ballot_norm: string;
  years: string; // anos de eleição, separados por vírgula
  best: number; // 2 = eleito, 1 = suplente, 0 = outro
}

/** Quantos anos de atividade (activeYears) caem dentro dos mandatos das candidaturas. */
function coverage(c: Cand, activeYears: number[]): number {
  const elections = c.years.split(",").map(Number);
  return activeYears.filter((y) => elections.some((e) => y >= e + 1 && y <= e + 4)).length;
}

function pick(cands: Cand[], activeYears: number[]): Cand | null {
  if (cands.length === 0) return null;
  if (cands.length === 1) return cands[0];
  const scored = cands
    .map((c) => ({ c, score: coverage(c, activeYears) * 10 + c.best }))
    .sort((a, b) => b.score - a.score);
  return scored[0].score > scored[1].score ? scored[0].c : null; // empate = ambíguo, não liga
}

async function linkSource(
  env: Env,
  source: "alesc" | "cmf" | "alesc_comp" | "camara" | "senado" | "emenda",
  aliases: { alias: string; years: string; name?: string | null }[],
  office: string | string[],
  unit: string,
) {
  const offices = [office].flat();
  const { results: cands } = await env.DB.prepare(
    `SELECT p.id AS politician_id, p.name_norm, p.ballot_norm,
            group_concat(DISTINCT c.year) AS years,
            max(CASE WHEN c.elected = 1 THEN 2 WHEN c.result LIKE 'SUPLENTE%' THEN 1 ELSE 0 END) AS best
       FROM candidacy c JOIN politician p ON p.id = c.politician_id
      WHERE c.unit = ?1 AND c.office IN (${offices.map((_, i) => `?${i + 2}`).join(", ")})
      GROUP BY p.id`,
  )
    .bind(unit, ...offices)
    .all<Cand>();
  // Só quem foi eleito ou suplente pode ter exercido mandato.
  const pool = cands.filter((c) => c.best > 0);

  const links: Record<string, unknown>[] = [];
  const unmatched: string[] = [];
  for (const { alias, years, name } of aliases) {
    // O nome usado para casar pode ser diferente da chave guardada (ex.: código do parlamentar).
    const label = name ?? alias;
    const active = years.split(",").map(Number);
    let chosen: Cand | null = null;
    let method = "exact";
    for (const v of aliasVariants(label)) {
      chosen = pick(pool.filter((c) => c.ballot_norm === v || c.name_norm === v), active);
      if (chosen) break;
    }
    if (!chosen) {
      method = "tokens";
      for (const v of aliasVariants(label)) {
        const t = tokens(v);
        if (t.length === 0) continue;
        const hits = pool.filter((c) => {
          const have = new Set([...tokens(c.name_norm), ...tokens(c.ballot_norm)]);
          return t.every((x) => have.has(x));
        });
        chosen = pick(hits, active);
        if (chosen) break;
      }
    }
    if (!chosen) {
      // Grafia diferente entre fontes ("Krasniack" x "KRASNIAK"): 1 caractere de diferença em nomes longos.
      method = "fuzzy";
      for (const v of aliasVariants(label)) {
        if (v.length < 10) continue;
        chosen = pick(pool.filter((c) => editDistanceAtMost1(v, c.ballot_norm) || editDistanceAtMost1(v, c.name_norm)), active);
        if (chosen) break;
      }
    }
    if (!chosen && source === "alesc_comp") {
      // O complemento dos pagamentos vem cortado em 20 caracteres ("MAURÍCIO JOSÉ ESKUDL").
      method = "prefix";
      for (const v of prefixVariants(label)) {
        chosen = pick(pool.filter((c) => c.name_norm.startsWith(v) || c.ballot_norm.startsWith(v)), active);
        if (chosen) break;
      }
    }
    if (chosen) links.push({ source, alias, politician_id: chosen.politician_id, method });
    else unmatched.push(label);
  }
  await env.DB.prepare("DELETE FROM mandate_link WHERE source = ?1 AND method <> 'manual'").bind(source).run();
  await insertJsonRows(env.DB, "mandate_link", ["source", "alias", "politician_id", "method"], links, {
    onConflict: "OR IGNORE",
  });
  return { source, linked: links.length, unmatched };
}

export async function relinkMandates(env: Env) {
  const { results: alesc } = await env.DB.prepare(
    "SELECT account AS alias, group_concat(DISTINCT year) AS years FROM alesc_expense GROUP BY account",
  ).all<{ alias: string; years: string }>();
  const { results: cmf } = await env.DB.prepare(
    `SELECT office AS alias, group_concat(DISTINCT substr(ref_month, 1, 4)) AS years
       FROM cmf_staff WHERE office LIKE 'Gabinete %' GROUP BY office`,
  ).all<{ alias: string; years: string }>();
  // Complemento dos pagamentos da ALESC na atividade parlamentar: nome do deputado de referência.
  const { results: comp } = await env.DB.prepare(
    `SELECT complemento AS alias, group_concat(DISTINCT year) AS years FROM alesc_payment
      WHERE subacao = '15915' AND complemento IS NOT NULL GROUP BY complemento`,
  ).all<{ alias: string; years: string }>();
  const out = [
    await linkSource(env, "alesc", alesc, "DEPUTADO ESTADUAL", "SC"),
    await linkSource(env, "cmf", cmf, "VEREADOR", "FLORIANÓPOLIS"),
    await linkSource(env, "alesc_comp", comp, "DEPUTADO ESTADUAL", "SC"),
  ];
  out.push(...(await linkFederal(env)));
  out.push(await linkEmendaAuthors(env));
  await rebuildPayeeDocs(env);
  return out;
}

/**
 * Autor de emenda (nome parlamentar, como o Portal da Transparência publica) -> pessoa,
 * pelo parlamentar da Câmara/Senado com o mesmo nome já ligado ao TSE.
 */
async function linkEmendaAuthors(env: Env) {
  const { results: members } = await env.DB.prepare(
    `SELECT m.name, m.full_name, l.politician_id FROM fed_member m
       JOIN mandate_link l ON l.source = m.house AND l.alias = m.member_id`,
  ).all<{ name: string; full_name: string | null; politician_id: string }>();
  const byName = new Map<string, Set<string>>();
  for (const m of members) {
    for (const n of [m.name, m.full_name]) {
      if (!n) continue;
      const k = normalizeName(n);
      if (!byName.has(k)) byName.set(k, new Set());
      byName.get(k)!.add(m.politician_id);
    }
  }
  const { results: authors } = await env.DB.prepare("SELECT DISTINCT author_norm FROM emenda").all<{ author_norm: string }>();
  const links: Record<string, unknown>[] = [];
  const unmatched: string[] = [];
  for (const { author_norm } of authors) {
    const ids = byName.get(author_norm);
    if (ids && ids.size === 1) links.push({ source: "emenda", alias: author_norm, politician_id: [...ids][0], method: "nome_parlamentar" });
    else unmatched.push(author_norm);
  }
  await env.DB.prepare("DELETE FROM mandate_link WHERE source = 'emenda' AND method <> 'manual'").run();
  await insertJsonRows(env.DB, "mandate_link", ["source", "alias", "politician_id", "method"], links, { onConflict: "OR IGNORE" });
  return { source: "emenda" as const, linked: links.length, unmatched };
}

/** Deputados federais: CPF publicado pela Câmara = CPF do TSE (exato). Senado: nome completo. */
async function linkFederal(env: Env) {
  const members = async (house: string) =>
    (
      await env.DB.prepare(
        `SELECT m.member_id AS alias, coalesce(m.full_name, m.name) AS name,
                (SELECT group_concat(DISTINCT year) FROM fed_expense e WHERE e.house = m.house AND e.member_id = m.member_id) AS years
           FROM fed_member m WHERE m.house = ?1`,
      )
        .bind(house)
        .all<{ alias: string; name: string; years: string | null }>()
    ).results.map((m) => ({ ...m, years: m.years ?? "" }));
  const camara = await linkSource(env, "camara", await members("camara"), "DEPUTADO FEDERAL", "SC");
  // CPF vence o nome: substitui qualquer ligação automática por nome.
  await env.DB.prepare(
    `INSERT OR REPLACE INTO mandate_link (source, alias, politician_id, method)
     SELECT 'camara', m.member_id, min(p.id), 'cpf' FROM fed_member m JOIN politician p ON p.cpf = m.cpf
      WHERE m.house = 'camara' AND m.cpf IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM mandate_link x WHERE x.source = 'camara' AND x.alias = m.member_id AND x.method = 'manual')
      GROUP BY m.member_id HAVING count(DISTINCT p.id) = 1`,
  ).run();
  const senado = await linkSource(env, "senado", await members("senado"), ["SENADOR", "1º SUPLENTE", "2º SUPLENTE"], "SC");
  const byCpf = await env.DB.prepare("SELECT count(*) AS n FROM mandate_link WHERE source = 'camara' AND method = 'cpf'").first<{ n: number }>();
  return [{ ...camara, by_cpf: byCpf?.n ?? 0 }, senado];
}

/**
 * Favorecido do CSV de gabinetes -> CNPJ. Só quando o nome normalizado aparece
 * nos pagamentos a credores com um único CNPJ (nome ambíguo não é ligado).
 */
async function rebuildPayeeDocs(env: Env) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM alesc_payee_doc"),
    env.DB.prepare(
      `INSERT INTO alesc_payee_doc (payee_norm, doc, credor)
       SELECT p.credor_norm, min(p.doc), max(p.credor) FROM alesc_payment p
        WHERE p.doc IS NOT NULL AND length(p.credor_norm) >= 6
          AND p.credor_norm IN (SELECT DISTINCT payee_norm FROM alesc_expense WHERE payee_norm IS NOT NULL)
        GROUP BY p.credor_norm HAVING count(DISTINCT p.doc) = 1`,
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Sinais
// ---------------------------------------------------------------------------

const ENTITY_NAME: Record<number, string> = { 2002: "Prefeitura", 1018: "Câmara" };
const brl = (c: number) =>
  (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

// Bancos, concessionárias e órgãos públicos prestam serviço a quase todos: não são indício.
const UBIQUITOUS =
  /\b(BANCO|CAIXA ECONOMICA|CELESC|CASAN|CORREIOS|EMPRESA BRASILEIRA|TELEFONICA|CLARO|TIM SA|OI SA|VIVO|COMCAP|CONSORCIO FENIX|PREFEITURA|MUNICIPIO|ESTADO DE|SECRETARIA|FUNDACAO|INSTITUTO NACIONAL|RECEITA FEDERAL)\b/;
// Fornecedor que atendeu muitas campanhas é prestador de mercado, não vínculo particular.
const MAX_CAMPAIGNS_PER_SUPPLIER = 5;

/** R1: quem financiou ou prestou serviço à campanha de um eleito e depois recebeu da Prefeitura/Câmara. */
async function ruleCampaignToPayee(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `WITH reach AS (
       SELECT supplier_doc AS doc, count(DISTINCT sq_candidato) AS campaigns
         FROM campaign_expense WHERE length(supplier_doc) = 14 GROUP BY supplier_doc
     ), camp AS (
       SELECT c.politician_id, c.year AS election, c.office, c.elected, 'doacao' AS role,
              r.donor_doc AS doc, max(r.donor_name) AS name, sum(r.amount_cents) AS camp_cents
         FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato
        WHERE c.unit = 'FLORIANÓPOLIS' AND c.elected = 1 AND length(r.donor_doc) IN (11, 14)
          AND r.origin NOT LIKE '%partido%' AND r.origin NOT LIKE '%próprios%' AND r.origin NOT LIKE '%candidato%'
        GROUP BY c.politician_id, c.year, r.donor_doc
       UNION ALL
       SELECT c.politician_id, c.year, c.office, c.elected, 'fornecedor',
              e.supplier_doc, max(e.supplier_name), sum(e.amount_cents)
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
        WHERE c.unit = 'FLORIANÓPOLIS' AND c.elected = 1 AND length(e.supplier_doc) = 14
        GROUP BY c.politician_id, c.year, e.supplier_doc
     )
     SELECT camp.*, p.entity, max(p.name) AS payee_name, sum(p.paid_cents) AS paid_cents,
            coalesce(reach.campaigns, 0) AS campaigns
       FROM camp JOIN epublica_payee_year p ON p.doc = camp.doc
       LEFT JOIN reach ON reach.doc = camp.doc
      WHERE p.year > camp.election AND p.year <= camp.election + 4 AND p.paid_cents > 0
      GROUP BY camp.politician_id, camp.election, camp.role, camp.doc, p.entity`,
  ).all<any>();

  const candidates = results.filter(
    (r) =>
      r.paid_cents >= 1_000_000 && // R$ 10 mil recebidos
      r.camp_cents >= 50_000 && // R$ 500 na campanha
      r.campaigns <= MAX_CAMPAIGNS_PER_SUPPLIER &&
      !UBIQUITOUS.test(normalizeName(`${r.name} ${r.payee_name}`)),
  );
  if (candidates.length === 0) return [];

  // Histórico completo de pagamentos de cada CNPJ, para comparar antes e depois da eleição.
  const docs = [...new Set(candidates.map((r) => r.doc as string))];
  const history = new Map<string, Map<number, number>>();
  const firstYear = (await env.DB.prepare("SELECT min(year) AS y FROM epublica_payee_year").first<{ y: number }>())?.y ?? 9999;
  for (let i = 0; i < docs.length; i += 90) {
    const chunk = docs.slice(i, i + 90);
    const { results: rows } = await env.DB.prepare(
      `SELECT doc, entity, year, sum(paid_cents) AS cents FROM epublica_payee_year
        WHERE doc IN (${chunk.map((_, j) => `?${j + 1}`).join(",")}) GROUP BY doc, entity, year`,
    )
      .bind(...chunk)
      .all<{ doc: string; entity: number; year: number; cents: number }>();
    for (const h of rows) {
      const k = `${h.doc}|${h.entity}`;
      if (!history.has(k)) history.set(k, new Map());
      history.get(k)!.set(h.year, h.cents);
    }
  }
  const currentYear = new Date().getUTCFullYear();

  const out: Record<string, unknown>[] = [];
  for (const r of candidates) {
    const h = history.get(`${r.doc}|${r.entity}`) ?? new Map<number, number>();
    const preYears = [r.election - 3, r.election - 2, r.election - 1, r.election].filter((y) => y >= firstYear);
    // O ano corrente está incompleto; só entra na média se for o único ano depois da eleição.
    let postYears = [1, 2, 3, 4].map((d) => r.election + d).filter((y) => y < currentYear && h.has(y));
    if (postYears.length === 0) postYears = [1, 2, 3, 4].map((d) => r.election + d).filter((y) => h.has(y));
    const avg = (ys: number[]) => (ys.length ? ys.reduce((s, y) => s + (h.get(y) ?? 0), 0) / ys.length : 0);
    const preAvg = avg(preYears);
    const postAvg = avg(postYears);
    const baselineKnown = preYears.length >= 2;
    const isNew = baselineKnown && preAvg === 0;
    const growth = preAvg > 0 ? postAvg / preAvg : null;

    const entity = ENTITY_NAME[r.entity];
    const strongCampaign = r.camp_cents >= 1_000_000; // R$ 10 mil
    let severity: "low" | "medium" | "high";
    let headline: string;
    if (isNew) {
      severity = strongCampaign && r.paid_cents >= 50_000_000 ? "high" : r.paid_cents >= 5_000_000 ? "medium" : "low";
      headline = `passou a receber da ${entity}`;
    } else if (growth !== null && growth >= 2 && postAvg - preAvg >= 100_000_000) {
      severity = "medium";
      headline = `teve os pagamentos da ${entity} multiplicados por ${growth.toFixed(1).replace(".", ",")}`;
    } else if (baselineKnown) {
      severity = "low";
      headline = `já recebia da ${entity} antes da eleição`;
    } else {
      severity = strongCampaign || r.paid_cents >= 10_000_000 ? "medium" : "low";
      headline = `recebeu da ${entity}`;
    }
    const what = r.role === "doacao" ? `doou ${brl(r.camp_cents)} à campanha` : `recebeu ${brl(r.camp_cents)} da campanha`;
    const baselineText = !baselineKnown
      ? "Não há dados de pagamentos dos anos anteriores à eleição para comparar."
      : isNew
        ? `Não recebia da ${entity} nos anos anteriores à eleição (${preYears[0]}–${r.election}).`
        : `Antes da eleição (${preYears[0]}–${r.election}) recebia em média ${brl(preAvg)} por ano; depois, ${brl(postAvg)} por ano.`;
    out.push({
      key: await signalKey("campanha_depois_contrato", r.politician_id, r.election, r.role, r.doc, r.entity),
      rule: "campanha_depois_contrato",
      rule_version: "2",
      severity,
      title: `${r.name}: ${r.role === "doacao" ? "doador" : "fornecedor"} de campanha ${headline}`,
      detail:
        `${r.name} ${what} (${r.office.toLowerCase()}, ${r.election}${r.elected ? ", eleito" : ""}). ` +
        `No mandato seguinte, recebeu ${brl(r.paid_cents)} da ${entity} de Florianópolis. ${baselineText}`,
      politician_id: r.politician_id,
      doc: r.doc,
      amount_cents: r.paid_cents,
      evidence: JSON.stringify({
        election: r.election,
        role: r.role,
        campaign_cents: r.camp_cents,
        entity: r.entity,
        pre_years: preYears,
        post_years: postYears,
        pre_avg_cents: Math.round(preAvg),
        post_avg_cents: Math.round(postAvg),
        new_supplier: isNew,
        campaigns_served: r.campaigns,
      }),
      created_at: createdAt,
    });
  }
  return out;
}

async function signalKey(...parts: unknown[]): Promise<string> {
  return (await sha256Hex(parts.join("|"))).slice(0, 12);
}

/** R2: favorecido da verba de gabinete da ALESC com o mesmo nome de um fornecedor da campanha do deputado. */
async function ruleAlescPayeeCampaign(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `WITH a AS (
       SELECT l.politician_id, x.payee_norm, max(x.payee) AS payee, sum(x.amount_cents) AS alesc_cents,
              min(x.year) AS y0, max(x.year) AS y1, group_concat(DISTINCT x.category) AS cats
         FROM alesc_expense x JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
        WHERE length(x.payee_norm) >= 8 AND instr(x.payee_norm, ' ') > 0
          -- Diárias e passagens vão para servidores do gabinete, não para fornecedores.
          AND x.category NOT IN ('DIÁRIAS', 'PASSAGENS')
        GROUP BY l.politician_id, x.payee_norm
     ), c AS (
       SELECT cd.politician_id, e.supplier_name_norm AS name_norm, max(e.supplier_doc) AS doc,
              sum(e.amount_cents) AS camp_cents, group_concat(DISTINCT cd.year) AS elections
         FROM campaign_expense e JOIN candidacy cd ON cd.sq_candidato = e.sq_candidato
        WHERE cd.office = 'DEPUTADO ESTADUAL'
        GROUP BY cd.politician_id, e.supplier_name_norm
     )
     SELECT a.*, c.doc, c.camp_cents, c.elections
       FROM a JOIN c ON c.politician_id = a.politician_id AND c.name_norm = a.payee_norm`,
  ).all<any>();
  const out: Record<string, unknown>[] = [];
  for (const r of results.filter((r) => r.alesc_cents >= 500_000)) {
    // R$ 5 mil
    out.push({
      key: await signalKey("gabinete_fornecedor_campanha", r.politician_id, r.payee_norm),
      rule: "gabinete_fornecedor_campanha",
      rule_version: "1",
      severity: r.alesc_cents >= 10_000_000 ? "medium" : "low",
      title: `${r.payee}: pago pela verba de gabinete e pela campanha do mesmo deputado`,
      detail:
        `${r.payee} recebeu ${brl(r.alesc_cents)} da verba de gabinete (${r.cats.toLowerCase()}, ${r.y0}–${r.y1}) ` +
        `e ${brl(r.camp_cents)} da campanha do mesmo parlamentar (eleições ${r.elections}). ` +
        `Ligação por nome: a ALESC não publica o CNPJ do favorecido.`,
      politician_id: r.politician_id,
      doc: r.doc,
      amount_cents: r.alesc_cents,
      evidence: JSON.stringify({ payee_norm: r.payee_norm, alesc_cents: r.alesc_cents, campaign_cents: r.camp_cents, elections: r.elections }),
      created_at: createdAt,
    });
  }
  return out;
}

/** R3: gasto anual de um gabinete numa categoria muito acima da mediana dos colegas. */
async function ruleAlescOutlier(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `SELECT x.year, x.category, x.account, l.politician_id, sum(x.amount_cents) AS cents
       FROM alesc_expense x LEFT JOIN mandate_link l ON l.source = 'alesc' AND l.alias = x.account
      GROUP BY x.year, x.category, x.account`,
  ).all<{ year: number; category: string; account: string; politician_id: string | null; cents: number }>();
  const groups = new Map<string, typeof results>();
  for (const r of results) {
    const k = `${r.year}|${r.category}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Record<string, unknown>[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 10) continue; // pouca gente usando a categoria: comparação fraca
    const sorted = rows.map((r) => r.cents).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 0) continue;
    for (const r of rows) {
      const ratio = r.cents / median;
      if (ratio < 3 || r.cents < 2_000_000) continue; // 3x a mediana e ao menos R$ 20 mil
      out.push({
        key: await signalKey("gabinete_gasto_atipico", r.account, r.year, r.category),
        rule: "gabinete_gasto_atipico",
        rule_version: "1",
        severity: ratio >= 6 ? "high" : ratio >= 4 ? "medium" : "low",
        title: `${r.account}: ${r.category.toLowerCase()} em ${r.year} ${ratio.toFixed(1)}x a mediana`,
        detail:
          `O gabinete ${r.account} gastou ${brl(r.cents)} em ${r.category.toLowerCase()} em ${r.year}, ` +
          `${ratio.toFixed(1)} vezes a mediana dos ${rows.length} gabinetes que usaram a categoria no ano (${brl(median)}).`,
        politician_id: r.politician_id,
        doc: null,
        amount_cents: r.cents,
        evidence: JSON.stringify({ year: r.year, category: r.category, account: r.account, median_cents: median, peers: rows.length }),
        created_at: createdAt,
      });
    }
  }
  return out;
}

/** "HOSPEDAGEM ,EXCETO DO PARLAMENTAR NO DISTRITO FEDERAL." -> "hospedagem, exceto do parlamentar no distrito federal". */
export function prettyCategory(c: string): string {
  return c.toLowerCase().replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").replace(/[.\s]+$/, "").trim();
}

const HOUSE_LABEL: Record<string, { cota: string; who: string }> = {
  camara: { cota: "cota parlamentar da Câmara", who: "deputado" },
  senado: { cota: "cota parlamentar do Senado", who: "senador" },
};
// Companhias aéreas, operadoras e afins atendem todo mundo: não indicam vínculo.
const FED_UBIQUITOUS = /(GOL|LATAM|TAM|AZUL|AVIANCA|TELEFONICA|CLARO|TIM|OI|VIVO|CORREIOS|EMPRESA BRASILEIRA|BANCO|CAIXA)/;

/** R4: fornecedor pago pela cota parlamentar federal que também atendeu a campanha do mesmo parlamentar (por CNPJ). */
async function ruleFedQuotaCampaign(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `WITH q AS (
       SELECT l.politician_id, e.house, e.supplier_doc AS doc, max(e.supplier_name) AS name, sum(e.amount_cents) AS cota_cents,
              min(e.year) AS y0, max(e.year) AS y1, group_concat(DISTINCT e.category) AS cats
         FROM fed_expense e JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
        WHERE length(e.supplier_doc) = 14
        GROUP BY l.politician_id, e.house, e.supplier_doc
     ), c AS (
       SELECT cd.politician_id, x.supplier_doc AS doc, sum(x.amount_cents) AS camp_cents, group_concat(DISTINCT cd.year) AS elections
         FROM campaign_expense x JOIN candidacy cd ON cd.sq_candidato = x.sq_candidato
        WHERE length(x.supplier_doc) = 14
        GROUP BY cd.politician_id, x.supplier_doc
     ), reach AS (
       SELECT supplier_doc AS doc, count(DISTINCT sq_candidato) AS campaigns FROM campaign_expense
        WHERE length(supplier_doc) = 14 GROUP BY supplier_doc
     )
     SELECT q.*, c.camp_cents, c.elections, coalesce(reach.campaigns, 0) AS campaigns
       FROM q JOIN c ON c.politician_id = q.politician_id AND c.doc = q.doc
       LEFT JOIN reach ON reach.doc = q.doc`,
  ).all<any>();
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.cota_cents < 500_000 || r.campaigns > MAX_CAMPAIGNS_PER_SUPPLIER || FED_UBIQUITOUS.test(normalizeName(r.name))) continue;
    const h = HOUSE_LABEL[r.house];
    out.push({
      key: await signalKey("cota_fornecedor_campanha", r.politician_id, r.house, r.doc),
      rule: "cota_fornecedor_campanha",
      rule_version: "1",
      severity: r.cota_cents >= 10_000_000 && r.camp_cents >= 1_000_000 ? "high" : r.cota_cents >= 2_000_000 ? "medium" : "low",
      title: `${r.name}: pago pela cota parlamentar e pela campanha do mesmo ${h.who}`,
      detail:
        `${r.name} recebeu ${brl(r.cota_cents)} da ${h.cota} (${r.cats.split(",").map(prettyCategory).join("; ")}, ${r.y0}–${r.y1}) ` +
        `e ${brl(r.camp_cents)} da campanha do mesmo parlamentar (eleições ${r.elections}). Ligação por CNPJ.`,
      politician_id: r.politician_id,
      doc: r.doc,
      amount_cents: r.cota_cents,
      evidence: JSON.stringify({ house: r.house, cota_cents: r.cota_cents, campaign_cents: r.camp_cents, elections: r.elections, y0: r.y0, y1: r.y1 }),
      created_at: createdAt,
    });
  }
  return out;
}

/** R5: gasto anual de um parlamentar federal de SC numa categoria muito acima da mediana nacional. */
async function ruleFedOutlier(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `SELECT e.house, e.member_id, m.name, l.politician_id, e.year, e.category, sum(e.amount_cents) AS cents,
            s.median_cents, s.p90_cents, s.members
       FROM fed_expense e
       JOIN fed_category_stat s ON s.house = e.house AND s.year = e.year AND s.category = e.category
       JOIN fed_member m ON m.house = e.house AND m.member_id = e.member_id
       LEFT JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
      GROUP BY e.house, e.member_id, e.year, e.category`,
  ).all<any>();
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.members < 20 || r.median_cents <= 0) continue;
    const ratio = r.cents / r.median_cents;
    if (ratio < 3 || r.cents < 2_000_000 || r.cents <= r.p90_cents) continue;
    const h = HOUSE_LABEL[r.house];
    out.push({
      key: await signalKey("cota_gasto_atipico", r.house, r.member_id, r.year, r.category),
      rule: "cota_gasto_atipico",
      rule_version: "1",
      severity: ratio >= 6 ? "high" : ratio >= 4 ? "medium" : "low",
      title: `${r.name}: ${prettyCategory(r.category)} em ${r.year} ${ratio.toFixed(1)}x a mediana nacional`,
      detail:
        `${r.name} gastou ${brl(r.cents)} da ${h.cota} em ${prettyCategory(r.category)} em ${r.year}, ` +
        `${ratio.toFixed(1)} vezes a mediana dos ${r.members} parlamentares do país que usaram a categoria (${brl(r.median_cents)}).`,
      politician_id: r.politician_id,
      doc: null,
      amount_cents: r.cents,
      evidence: JSON.stringify({ house: r.house, member_id: r.member_id, year: r.year, category: r.category, median_cents: r.median_cents, p90_cents: r.p90_cents, members: r.members }),
      created_at: createdAt,
    });
  }
  return out;
}

const PUBLIC_NATUREZA = /munic|estad|fundo p|autarqui|[óo]rg[ãa]o p[úu]blico|funda[çc][ãa]o p[úu]blica|federal|economia mista|empresa p[úu]blica/i;

/** R6: quem recebeu dinheiro de emenda do parlamentar também financiou ou atendeu a campanha dele (por CPF/CNPJ). */
async function ruleEmendaCampaign(env: Env, createdAt: string) {
  const { results } = await env.DB.prepare(
    `WITH f AS (
       SELECT l.politician_id, ef.doc, max(ef.name) AS name, max(ef.kind) AS kind, max(ef.natureza) AS natureza, sum(ef.amount_cents) AS emenda_cents,
              count(DISTINCT ef.code) AS emendas, min(substr(ef.year_month, 1, 4)) AS y0, max(substr(ef.year_month, 1, 4)) AS y1
         FROM emenda_favorecido ef JOIN mandate_link l ON l.source = 'emenda' AND l.alias = ef.author_norm
        WHERE ef.doc IS NOT NULL
        GROUP BY l.politician_id, ef.doc
     ), c AS (
       SELECT cd.politician_id, x.supplier_doc AS doc, 'fornecedor' AS role, sum(x.amount_cents) AS camp_cents, group_concat(DISTINCT cd.year) AS elections
         FROM campaign_expense x JOIN candidacy cd ON cd.sq_candidato = x.sq_candidato
        WHERE x.supplier_doc IS NOT NULL GROUP BY cd.politician_id, x.supplier_doc
       UNION ALL
       SELECT cd.politician_id, r.donor_doc, 'doador', sum(r.amount_cents), group_concat(DISTINCT cd.year)
         FROM campaign_receipt r JOIN candidacy cd ON cd.sq_candidato = r.sq_candidato
        WHERE r.donor_doc IS NOT NULL AND r.origin NOT LIKE '%partido%' AND r.origin NOT LIKE '%próprios%'
        GROUP BY cd.politician_id, r.donor_doc
     )
     SELECT f.*, c.role, c.camp_cents, c.elections FROM f JOIN c ON c.politician_id = f.politician_id AND c.doc = f.doc`,
  ).all<any>();
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.emenda_cents < 1_000_000 || r.camp_cents < 50_000) continue; // R$ 10 mil da emenda, R$ 500 na campanha
    // Prefeituras, fundos e órgãos públicos recebem emendas por natureza; campanha paga taxas a eles.
    if (PUBLIC_NATUREZA.test(r.natureza ?? "") || UBIQUITOUS.test(normalizeName(r.name))) continue;
    const rel = r.role === "doador" ? `doou ${brl(r.camp_cents)} à campanha` : `recebeu ${brl(r.camp_cents)} da campanha`;
    out.push({
      key: await signalKey("emenda_campanha", r.politician_id, r.doc, r.role),
      rule: "emenda_campanha",
      rule_version: "1",
      severity: r.emenda_cents >= 50_000_000 ? "high" : r.emenda_cents >= 10_000_000 ? "medium" : "low",
      title: `${r.name}: recebeu emenda de quem ${r.role === "doador" ? "ajudou a financiar" : "contratou na campanha"}`,
      detail:
        `${r.name} recebeu ${brl(r.emenda_cents)} de ${r.emendas} emenda(s) parlamentar(es) do mesmo político (${r.y0}–${r.y1}) ` +
        `e ${rel} dele (eleições ${r.elections}). Ligação por ${String(r.doc).length === 14 ? "CNPJ" : "CPF"}.`,
      politician_id: r.politician_id,
      doc: r.doc,
      amount_cents: r.emenda_cents,
      evidence: JSON.stringify({ role: r.role, emenda_cents: r.emenda_cents, campaign_cents: r.camp_cents, elections: r.elections, emendas: r.emendas }),
      created_at: createdAt,
    });
  }
  return out;
}

/** R7: quem prestou serviço ou doou à campanha de governador/vice eleito e depois recebeu empenhos do Estado. */
async function ruleStateCampaign(env: Env, createdAt: string) {
  const first = (await env.DB.prepare("SELECT min(year) AS y FROM state_payee_year").first<{ y: number | null }>())?.y;
  if (!first) return [];
  const { results } = await env.DB.prepare(
    `WITH reach AS (
       SELECT supplier_doc AS doc, count(DISTINCT sq_candidato) AS campaigns FROM campaign_expense
        WHERE length(supplier_doc) = 14 GROUP BY supplier_doc
     ), camp AS (
       SELECT c.politician_id, c.year AS election, c.office, 'fornecedor' AS role, e.supplier_doc AS doc,
              max(e.supplier_name) AS name, sum(e.amount_cents) AS camp_cents
         FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
        WHERE c.office IN ('GOVERNADOR', 'VICE-GOVERNADOR') AND c.elected = 1 AND length(e.supplier_doc) = 14
        GROUP BY c.politician_id, c.year, e.supplier_doc
       UNION ALL
       SELECT c.politician_id, c.year, c.office, 'doacao', r.donor_doc, max(r.donor_name), sum(r.amount_cents)
         FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato
        WHERE c.office IN ('GOVERNADOR', 'VICE-GOVERNADOR') AND c.elected = 1 AND length(r.donor_doc) IN (11, 14)
          AND r.origin NOT LIKE '%partido%' AND r.origin NOT LIKE '%próprios%' AND r.origin NOT LIKE '%candidato%'
        GROUP BY c.politician_id, c.year, r.donor_doc
     )
     SELECT camp.*, coalesce(reach.campaigns, 0) AS campaigns,
            (SELECT group_concat(y || ':' || c, ',') FROM (
               SELECT year AS y, sum(committed_cents) AS c FROM state_payee_year s WHERE s.doc = camp.doc GROUP BY year)) AS history
       FROM camp LEFT JOIN reach ON reach.doc = camp.doc
      WHERE EXISTS (SELECT 1 FROM state_payee_year s WHERE s.doc = camp.doc AND s.year > camp.election)`,
  ).all<any>();
  const currentYear = new Date().getUTCFullYear();
  const out: Record<string, unknown>[] = [];
  for (const r of results) {
    if (r.camp_cents < 50_000 || r.campaigns > MAX_CAMPAIGNS_PER_SUPPLIER) continue;
    if (UBIQUITOUS.test(normalizeName(r.name)) || /\b(MUNICIPIO|FUNDO|ESTADO|SECRETARIA|FUNDACAO|UNIVERSIDADE)\b/.test(normalizeName(r.name))) continue;
    const h = new Map<number, number>(String(r.history ?? "").split(",").filter(Boolean).map((x: string) => x.split(":").map(Number) as [number, number]));
    const mandate = [1, 2, 3, 4].map((d) => r.election + d);
    const post = mandate.filter((y) => h.has(y));
    const paid = post.reduce((s, y) => s + (h.get(y) ?? 0), 0);
    if (paid < 1_000_000) continue; // R$ 10 mil
    const preYears = [r.election - 3, r.election - 2, r.election - 1, r.election].filter((y) => y >= first);
    let postFull = post.filter((y) => y < currentYear);
    if (postFull.length === 0) postFull = post;
    const avg = (ys: number[]) => (ys.length ? ys.reduce((s, y) => s + (h.get(y) ?? 0), 0) / ys.length : 0);
    const preAvg = avg(preYears);
    const postAvg = avg(postFull);
    const baselineKnown = preYears.length >= 2;
    const isNew = baselineKnown && preAvg <= 0;
    const growth = preAvg > 0 ? postAvg / preAvg : null;
    const strong = r.camp_cents >= 1_000_000;
    let severity: "low" | "medium" | "high";
    let headline: string;
    if (isNew) {
      severity = strong && paid >= 50_000_000 ? "high" : paid >= 5_000_000 ? "medium" : "low";
      headline = "passou a receber do Estado";
    } else if (growth !== null && growth >= 2 && postAvg - preAvg >= 100_000_000) {
      severity = "medium";
      headline = `teve os empenhos do Estado multiplicados por ${growth.toFixed(1).replace(".", ",")}`;
    } else if (baselineKnown) {
      severity = "low";
      headline = "já recebia do Estado antes da eleição";
    } else {
      severity = strong || paid >= 10_000_000 ? "medium" : "low";
      headline = "recebeu do Estado";
    }
    const what = r.role === "doacao" ? `doou ${brl(r.camp_cents)} à campanha` : `recebeu ${brl(r.camp_cents)} da campanha`;
    const baselineText = !baselineKnown
      ? `Os dados de empenhos do Estado começam em ${first}; não há base para comparar com antes da eleição.`
      : isNew
        ? `Não recebia do Estado nos anos anteriores à eleição (${preYears[0]}–${r.election}).`
        : `Antes da eleição (${preYears[0]}–${r.election}) recebia em média ${brl(preAvg)} por ano; depois, ${brl(postAvg)} por ano.`;
    out.push({
      key: await signalKey("estado_campanha_contrato", r.politician_id, r.election, r.role, r.doc),
      rule: "estado_campanha_contrato",
      rule_version: "1",
      severity,
      title: `${r.name}: ${r.role === "doacao" ? "doador" : "fornecedor"} de campanha ${headline}`,
      detail:
        `${r.name} ${what} (${r.office.toLowerCase()}, ${r.election}, eleito). No mandato seguinte, recebeu ` +
        `${brl(paid)} em empenhos do Governo de SC. ${baselineText}`,
      politician_id: r.politician_id,
      doc: r.doc,
      amount_cents: paid,
      evidence: JSON.stringify({ election: r.election, role: r.role, campaign_cents: r.camp_cents, pre_years: preYears, post_years: post, pre_avg_cents: Math.round(preAvg), post_avg_cents: Math.round(postAvg), new_supplier: isNew }),
      created_at: createdAt,
    });
  }
  return out;
}

export async function computeSignals(env: Env) {
  const createdAt = nowIso();
  const all = [
    ...(await ruleCampaignToPayee(env, createdAt)),
    ...(await ruleAlescPayeeCampaign(env, createdAt)),
    ...(await ruleAlescOutlier(env, createdAt)),
    ...(await ruleFedQuotaCampaign(env, createdAt)),
    ...(await ruleFedOutlier(env, createdAt)),
    ...(await ruleEmendaCampaign(env, createdAt)),
    ...(await ruleStateCampaign(env, createdAt)),
  ];
  await env.DB.prepare("DELETE FROM signal").run();
  await insertJsonRows(
    env.DB,
    "signal",
    ["key", "rule", "rule_version", "severity", "title", "detail", "politician_id", "doc", "amount_cents", "evidence", "created_at"],
    all,
  );
  const byRule: Record<string, number> = {};
  for (const s of all) byRule[s.rule as string] = (byRule[s.rule as string] ?? 0) + 1;
  return byRule;
}
