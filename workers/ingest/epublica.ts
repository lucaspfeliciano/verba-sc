// Coletor: portal e-Publica (Prefeitura e Câmara Municipal de Florianópolis).
//
// A API não é documentada. O que foi verificado:
//  - GET  {base}/{recurso}/listAll?ano=A&entidade=E devolve a 1ª página (25 linhas)
//    com o searchBean (filtros) e a paginação;
//  - POST no mesmo endereço com {pagination, searchBean} pagina (page começa em 1,
//    count até 300);
//  - os filtros só valem quando enviados em searchBean.searchProperties, no mesmo
//    formato que o site monta (ver buildSearchProperties).

import { brlToCents, digits, fetchRaw, insertJsonRows, normalizeName, recordCollection } from "./util";

const BASE = "https://transparencia.e-publica.net/epublica-portal/rest/florianopolis";
export const ENTITY_PMF = 2002;
export const ENTITY_CMF = 1018;
const PAGE_SIZE = 300;

export const ENTITY_SOURCE: Record<number, string> = {
  [ENTITY_PMF]: "epublica_pmf",
  [ENTITY_CMF]: "epublica_cmf",
};

interface SearchComponent {
  property: string;
  searchType: string;
  searchRestrictionType: string;
  condition: unknown;
  value?: unknown;
  valueCompare?: unknown;
  [k: string]: unknown;
}
interface ListResponse {
  rows: any[];
  pagination: { page: number; size: number; count: number; [k: string]: unknown };
  searchBean: {
    searchAdvanced: { name: string; hide: boolean; components: SearchComponent[] }[];
    searchProperties: unknown;
    [k: string]: unknown;
  };
}

function buildSearchProperties(sb: ListResponse["searchBean"], values: Record<string, [unknown, unknown?]>) {
  const sep = sb.searchAdvanced[0];
  const components = sep.components.map((c) => {
    const v = values[c.property];
    return v ? { ...c, value: v[0], ...(v[1] !== undefined ? { valueCompare: v[1] } : {}) } : { ...c };
  });
  const separator = { name: sep.name, hide: sep.hide, components: components.map((search) => ({ search, childs: [] })) };
  const props: Record<string, unknown> = {};
  for (const c of components) {
    if (!values[c.property]) continue;
    props[`${sep.name}${c.property}`] = {
      separator,
      property: c.property,
      key: c.property,
      searchType: c.searchType,
      searchRestrictionType: c.searchRestrictionType,
      condition: c.condition,
      // Recursos agrupados (ex.: diárias por movimento) exigem params.nestedName.
      params: c.params,
      value: c.value,
      ...(c.valueCompare !== undefined ? { valueCompare: c.valueCompare } : {}),
      childs: [],
    };
  }
  return { components, props };
}

/** Busca todas as páginas de um recurso com filtros; grava cada página no R2. */
async function listAllPages(
  env: Env,
  opts: { resource: string; dataset: string; entity: number; year: number; scope: string; filters: Record<string, [unknown, unknown?]> },
) {
  const url = `${BASE}/${opts.resource}/listAll?ano=${opts.year}&entidade=${opts.entity}`;
  const first = await fetchRaw(url, { headers: { Accept: "application/json" } });
  if (first.status !== 200) throw new Error(`e-Publica ${opts.resource}: HTTP ${first.status}`);
  const head = JSON.parse(new TextDecoder().decode(first.body)) as ListResponse;
  const sb = structuredClone(head.searchBean);
  const { components, props } = buildSearchProperties(sb, opts.filters);
  sb.searchAdvanced[0].components = components;
  sb.searchProperties = Object.keys(props).length ? props : null;

  const rows: { row: any; collectionId: number }[] = [];
  for (let page = 1; page < 500; page++) {
    const body = JSON.stringify({ pagination: { ...head.pagination, page, count: PAGE_SIZE }, searchBean: sb });
    const raw = await fetchRaw(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      timeoutMs: 180_000,
    });
    if (raw.status !== 200) {
      throw new Error(`e-Publica ${opts.resource} p${page}: HTTP ${raw.status} ${new TextDecoder().decode(raw.body).slice(0, 200)}`);
    }
    const data = JSON.parse(new TextDecoder().decode(raw.body)) as ListResponse;
    const collectionId = await recordCollection(env, {
      source: ENTITY_SOURCE[opts.entity],
      dataset: opts.dataset,
      scope: `${opts.scope}-p${page}`,
      raw,
      ext: "json",
      rows: data.rows.length,
    });
    for (const row of data.rows) rows.push({ row, collectionId });
    if (data.rows.length < PAGE_SIZE || rows.length >= data.pagination.size) break;
  }
  return rows;
}

/** "Gastos por favorecido": totais anuais por favorecido, por data de emissão do empenho. */
export async function ingestPayeesYear(env: Env, entity: number, year: number) {
  const rows = await listAllPages(env, {
    resource: "despesa/avancado/gastosfavorecido",
    dataset: "gastos_favorecido",
    entity,
    year,
    scope: String(year),
    filters: { "empenho.emissao": [`${year}-01-01`, `${year}-12-31`] },
  });
  const merged = new Map<string, Record<string, unknown>>();
  for (const { row, collectionId } of rows) {
    const p = row.fornecedor?.pessoa ?? {};
    const name = String(p.nome ?? row.fornecedor?.nome ?? "").trim();
    const docFmt = String(p.cpfCnpj ?? "").trim();
    const doc = digits(docFmt) || `NOME:${normalizeName(name)}`;
    const v = row.valores ?? {};
    const key = `${doc}|${name}`;
    const prev = merged.get(key);
    const rec = {
      entity,
      year,
      doc,
      doc_fmt: docFmt || null,
      name,
      name_norm: normalizeName(name),
      committed_cents: brlToCents(v.EMPENHO_EMISSAO ?? 0) + Number(prev?.committed_cents ?? 0),
      cancelled_cents: brlToCents(v.EMPENHO_ANULACAO ?? 0) + Number(prev?.cancelled_cents ?? 0),
      liquidated_cents: brlToCents(v.EMPENHO_LIQUIDACAO ?? 0) + Number(prev?.liquidated_cents ?? 0),
      paid_cents: brlToCents(v.EMPENHO_PAGAMENTO ?? 0) + Number(prev?.paid_cents ?? 0),
      collection_id: collectionId,
    };
    merged.set(key, rec);
  }
  await env.DB.prepare("DELETE FROM epublica_payee_year WHERE entity = ?1 AND year = ?2").bind(entity, year).run();
  const list = [...merged.values()];
  await insertJsonRows(
    env.DB,
    "epublica_payee_year",
    ["entity", "year", "doc", "doc_fmt", "name", "name_norm", "committed_cents", "cancelled_cents", "liquidated_cents", "paid_cents", "collection_id"],
    list,
  );
  const paid = list.reduce((s, r) => s + Number(r.paid_cents), 0);
  return { entity, year, payees: list.length, paid_cents: paid };
}

/** Diárias por empenho (Prefeitura). */
export async function ingestPerDiemYear(env: Env, entity: number, year: number) {
  const rows = await listAllPages(env, {
    resource: "despesa/avancado/diaria/fornecedor",
    dataset: "diarias",
    entity,
    year,
    scope: String(year),
    filters: { "listMovimentos.dataMovimento": [`${year}-01-01`, `${year}-12-31`] },
  });
  const list = new Map<number, Record<string, unknown>>();
  for (const { row, collectionId } of rows) {
    const e = row.empenho ?? {};
    if (!e.id) continue;
    const p = row.fornecedor?.pessoa ?? {};
    const name = String(p.nome ?? row.fornecedor?.nome ?? "").trim();
    const v = row.valores ?? {};
    list.set(e.id, {
      entity,
      empenho_id: e.id,
      year,
      issued_at: e.emissao ?? null,
      beneficiary: name,
      beneficiary_norm: normalizeName(name),
      doc: digits(p.cpfCnpj) || null,
      role: (e.recursoDiaria?.cargo ?? "").trim() || null,
      unit: (row.unidadeOrcamentaria?.unidadeGestora?.denominacao ?? "").trim() || null,
      committed_cents: brlToCents(v.EMPENHO_EMISSAO ?? 0),
      paid_cents: brlToCents(v.EMPENHO_PAGAMENTO ?? 0),
      collection_id: collectionId,
    });
  }
  await env.DB.prepare("DELETE FROM pmf_per_diem WHERE entity = ?1 AND year = ?2").bind(entity, year).run();
  await insertJsonRows(
    env.DB,
    "pmf_per_diem",
    ["entity", "empenho_id", "year", "issued_at", "beneficiary", "beneficiary_norm", "doc", "role", "unit", "committed_cents", "paid_cents", "collection_id"],
    [...list.values()],
    { onConflict: "OR REPLACE" },
  );
  return { entity, year, per_diems: list.size };
}

/** Comissionados da Câmara (foto do mês mais recente publicado). */
export async function ingestStaffSnapshot(env: Env, entity: number) {
  const year = new Date().getUTCFullYear();
  const rows = await listAllPages(env, {
    resource: "gestaoDePessoal/comissionados",
    dataset: "comissionados",
    entity,
    year,
    scope: new Date().toISOString().slice(0, 10),
    filters: {},
  });
  const list = rows.map(({ row, collectionId }) => ({
    entity,
    ref_month: `${row.anoReferencia}-${String(row.mesReferencia).padStart(2, "0")}`,
    registration: String(row.matricula ?? row.idPrincipal),
    name: String(row.nome ?? "").trim(),
    role: row.cargo ?? null,
    office: (row.local ?? "").trim() || null,
    bond: row.vinculo ?? null,
    admitted_at: row.dataAdmissao ?? null,
    gross_cents: brlToCents(row.valorVantagens ?? 0),
    discounts_cents: brlToCents(row.valorDescontos ?? 0),
    collection_id: collectionId,
  }));
  const months = [...new Set(list.map((r) => r.ref_month))];
  for (const m of months) {
    await env.DB.prepare("DELETE FROM cmf_staff WHERE entity = ?1 AND ref_month = ?2").bind(entity, m).run();
  }
  await insertJsonRows(
    env.DB,
    "cmf_staff",
    ["entity", "ref_month", "registration", "name", "role", "office", "bond", "admitted_at", "gross_cents", "discounts_cents", "collection_id"],
    list,
    { onConflict: "OR REPLACE" },
  );
  return { entity, months, staff: list.length };
}
