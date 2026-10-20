// Coletores: cota parlamentar de deputados federais (CEAP, Câmara) e senadores
// (CEAPS, Senado). Os arquivos cobrem o país inteiro; guardamos os lançamentos
// de quem é de SC e, de todos, só a estatística por categoria (para comparação).

import { CsvStream, unzipFirstFileText } from "./csvstream";
import { digits, fetchRaw, insertJsonRows, normalizeName, recordCollection } from "./util";

export const CAMARA_FIRST_YEAR = 2015;
export const SENADO_FIRST_YEAR = 2015;

type Stat = Map<string, Map<string, number>>; // categoria -> parlamentar -> centavos

function addStat(stats: Stat, category: string, member: string, cents: number) {
  if (!stats.has(category)) stats.set(category, new Map());
  const m = stats.get(category)!;
  m.set(member, (m.get(member) ?? 0) + cents);
}

async function saveStats(env: Env, house: string, year: number, stats: Stat) {
  const rows: Record<string, unknown>[] = [];
  for (const [category, byMember] of stats) {
    const v = [...byMember.values()].filter((x) => x > 0).sort((a, b) => a - b);
    if (v.length === 0) continue;
    rows.push({
      house,
      year,
      category,
      members: v.length,
      median_cents: v[Math.floor(v.length / 2)],
      p90_cents: v[Math.min(v.length - 1, Math.floor(v.length * 0.9))],
    });
  }
  await env.DB.prepare("DELETE FROM fed_category_stat WHERE house = ?1 AND year = ?2").bind(house, year).run();
  await insertJsonRows(env.DB, "fed_category_stat", ["house", "year", "category", "members", "median_cents", "p90_cents"], rows);
}

const clean = (s: string | undefined) => (s ?? "").trim() || null;

// ---------------------------------------------------------------------------
// Câmara dos Deputados — https://www.camara.leg.br/cotas/Ano-AAAA.csv.zip
// ---------------------------------------------------------------------------

export async function ingestCamaraYear(env: Env, year: number) {
  const url = `https://www.camara.leg.br/cotas/Ano-${year}.csv.zip`;
  const raw = await fetchRaw(url, { timeoutMs: 300_000 });
  if (raw.status !== 200) throw new Error(`Câmara ${year}: HTTP ${raw.status}`);

  let header: string[] | null = null;
  let col: Record<string, number> = {};
  const stats: Stat = new Map();
  const members = new Map<string, Record<string, unknown>>();
  const rows: Record<string, unknown>[] = [];
  let total = 0;

  const parser = new CsvStream(";", (r) => {
    if (!header) {
      header = r.map((h) => h.replace(/^﻿/, "").trim());
      col = Object.fromEntries(header.map((h, i) => [h, i]));
      for (const need of ["sgUF", "ideCadastro", "txtDescricao", "vlrLiquido", "txtCNPJCPF"]) {
        if (!(need in col)) throw new Error(`Câmara ${year}: coluna ${need} ausente`);
      }
      return;
    }
    total++;
    const g = (k: string) => r[col[k]] ?? "";
    const member = g("ideCadastro");
    const uf = g("sgUF");
    // vlrLiquido usa ponto decimal ("1234.56").
    const cents = Math.round(Number(g("vlrLiquido") || 0) * 100) || 0;
    const category = g("txtDescricao").trim();
    // Lideranças e órgãos não têm UF nem cadastro de parlamentar: ficam fora da comparação.
    if (!member || !uf) return;
    addStat(stats, category, member, cents);
    if (uf !== "SC") return;
    members.set(member, {
      house: "camara",
      member_id: member,
      name: g("txNomeParlamentar").trim(),
      full_name: null,
      cpf: digits(g("cpf")) || null,
      party: clean(g("sgPartido")),
      role: null,
    });
    const doc = digits(g("txtCNPJCPF"));
    const passenger = clean(g("txtPassageiro"));
    const route = clean(g("txtTrecho"));
    rows.push({
      house: "camara",
      member_id: member,
      year,
      month: Number(g("numMes")) || null,
      issued_at: clean(g("datEmissao"))?.slice(0, 10) ?? null,
      category,
      supplier_doc: doc.length === 14 || doc.length === 11 ? doc : null,
      supplier_name: clean(g("txtFornecedor")),
      supplier_norm: clean(g("txtFornecedor")) ? normalizeName(g("txtFornecedor")) : null,
      doc_number: clean(g("txtNumero")),
      amount_cents: cents,
      document_url: clean(g("urlDocumento")),
      detail: [passenger && `Passageiro: ${passenger}`, route && `Trecho: ${route}`].filter(Boolean).join(" · ") || null,
    });
  });
  unzipFirstFileText(raw.body, (t) => parser.push(t));
  parser.end();

  const collectionId = await recordCollection(env, { source: "camara", dataset: "ceap", scope: String(year), raw, ext: "zip", rows: rows.length });
  await env.DB.prepare("DELETE FROM fed_expense WHERE house = 'camara' AND year = ?1").bind(year).run();
  await insertJsonRows(
    env.DB,
    "fed_expense",
    ["house", "member_id", "year", "month", "issued_at", "category", "supplier_doc", "supplier_name", "supplier_norm", "doc_number", "amount_cents", "document_url", "detail", "collection_id"],
    rows.map((r) => ({ ...r, collection_id: collectionId })),
  );
  await insertJsonRows(env.DB, "fed_member", ["house", "member_id", "name", "full_name", "cpf", "party", "role"], [...members.values()], {
    onConflict: "OR REPLACE",
  });
  await saveStats(env, "camara", year, stats);
  return { year, national_rows: total, sc_rows: rows.length, sc_members: members.size, sc_cents: rows.reduce((s, r) => s + Number(r.amount_cents), 0) };
}

// ---------------------------------------------------------------------------
// Senado Federal — API de dados abertos administrativos
// ---------------------------------------------------------------------------

/** Senadores e suplentes que tiveram mandato por SC nas legislaturas 54 a 58 (2011–2034). */
async function scSenators(env: Env) {
  const url = "https://legis.senado.leg.br/dadosabertos/senador/lista/legislatura/54/58.json";
  const raw = await fetchRaw(url, { headers: { Accept: "application/json" } });
  if (raw.status !== 200) throw new Error(`Senado lista: HTTP ${raw.status}`);
  const data = JSON.parse(new TextDecoder().decode(raw.body));
  const list = data?.ListaParlamentarLegislatura?.Parlamentares?.Parlamentar ?? [];
  const out = new Map<string, Record<string, unknown>>();
  for (const p of list) {
    const mandates = [p.Mandatos?.Mandato ?? []].flat();
    const sc = mandates.find((m: any) => m?.UfParlamentar === "SC");
    if (!sc) continue;
    const id = p.IdentificacaoParlamentar;
    out.set(String(id.CodigoParlamentar), {
      house: "senado",
      member_id: String(id.CodigoParlamentar),
      name: id.NomeParlamentar,
      full_name: id.NomeCompletoParlamentar ?? null,
      cpf: null,
      party: id.SiglaPartidoParlamentar ?? null,
      role: sc.DescricaoParticipacao ?? null,
    });
  }
  await recordCollection(env, { source: "senado", dataset: "senadores", scope: "54-58", raw, ext: "json", rows: out.size });
  return out;
}

export async function ingestSenadoYear(env: Env, year: number) {
  const senators = await scSenators(env);
  const url = `https://adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/${year}`;
  const raw = await fetchRaw(url, { headers: { Accept: "application/json" }, timeoutMs: 300_000 });
  if (raw.status !== 200) throw new Error(`Senado CEAPS ${year}: HTTP ${raw.status}`);
  const list = JSON.parse(new TextDecoder().decode(raw.body)) as any[];
  const stats: Stat = new Map();
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    const member = String(e.codSenador);
    const cents = Math.round(Number(e.valorReembolsado ?? 0) * 100);
    const category = String(e.tipoDespesa ?? "").trim();
    addStat(stats, category, member, cents);
    if (!senators.has(member)) continue;
    seen.add(member);
    const doc = digits(e.cpfCnpj);
    rows.push({
      house: "senado",
      member_id: member,
      year,
      month: Number(e.mes) || null,
      issued_at: e.data ? String(e.data).slice(0, 10) : null,
      category,
      supplier_doc: doc.length === 14 || doc.length === 11 ? doc : null,
      supplier_name: clean(e.fornecedor),
      supplier_norm: e.fornecedor ? normalizeName(e.fornecedor) : null,
      doc_number: clean(e.documento),
      amount_cents: cents,
      document_url: null,
      detail: clean(e.detalhamento),
    });
  }
  const collectionId = await recordCollection(env, { source: "senado", dataset: "ceaps", scope: String(year), raw, ext: "json", rows: rows.length });
  await env.DB.prepare("DELETE FROM fed_expense WHERE house = 'senado' AND year = ?1").bind(year).run();
  await insertJsonRows(
    env.DB,
    "fed_expense",
    ["house", "member_id", "year", "month", "issued_at", "category", "supplier_doc", "supplier_name", "supplier_norm", "doc_number", "amount_cents", "document_url", "detail", "collection_id"],
    rows.map((r) => ({ ...r, collection_id: collectionId })),
  );
  await insertJsonRows(env.DB, "fed_member", ["house", "member_id", "name", "full_name", "cpf", "party", "role"], [...senators.values()], {
    onConflict: "OR REPLACE",
  });
  await saveStats(env, "senado", year, stats);
  return { year, national_rows: list.length, sc_rows: rows.length, sc_members: seen.size };
}
