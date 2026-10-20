// Coletor: Poder Executivo de SC (dados.sc.gov.br, Secretaria de Estado da Fazenda).
//  - Empenhos por ano (CSV ~160 MB, desde 2021): agregados por credor e órgão; em
//    detalhe só Gabinete do Governador, Vice-Governadoria, Comunicação e empenhos
//    cujo credor é o próprio governador ou vice.
//  - Contratos (CSV ~74 MB, histórico completo, atualizado diariamente).
// Os arquivos são lidos direto da rede, em fluxo; o SHA-256 é calculado durante a leitura.

import { CsvStream } from "./csvstream";
import { digits, insertJsonRows, normalizeName, nowIso, UA } from "./util";

export const ESTADO_FIRST_YEAR = 2021;

const EMPENHOS_URL: Record<number, string> = {
  2021: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/da4404a7-9ba2-4d7d-b3ce-f2e5363ad07f/download/empenhos-2021.csv",
  2022: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/2ef589a3-f0f0-4348-a0ee-13197c2267cf/download/empenhos-2022.csv",
  2023: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/9b8da8e2-d5dc-45df-8588-0fe08b6bd703/download/empenhos-2023.csv",
  2024: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/4f06ef23-1496-4cce-84a1-c782eeaba36c/download/empenhos-2024.csv",
  2025: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/bacd7bc8-df50-4232-8595-3d32623e984e/download/empenhos-2025.csv",
  2026: "https://dados.sc.gov.br/dataset/688fb5ba-ab8f-4b42-bbad-4d363ba08a58/resource/6cb8afcb-c483-4859-9c21-e2de7869055c/download/empenhos-2026.csv",
};
const CONTRATOS_URL =
  "https://dados.sc.gov.br/dataset/93dab950-e805-4388-8418-cfb3b73f1623/resource/ff7c3cac-3e38-4801-9fd8-e4ccb69ca31d/download/contratos.csv";

/** Órgãos guardados em detalhe (empenho a empenho). */
export const FOCUS_ORGAO = /gabinete governador|vice-governador|secretaria de estado da comunica/i;

/** Lê um CSV remoto em fluxo; devolve hash, tamanho e status. */
async function streamCsv(url: string, quote: string, onRow: (r: string[]) => void) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(600_000) });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} em ${url}`);
  const [forHash, forText] = res.body.tee();
  // DigestStream é do runtime dos Workers; os tipos do DOM (usados pelo app) não o conhecem.
  type DigestStreamT = WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> };
  const DigestStream = (crypto as unknown as { DigestStream: new (alg: string) => DigestStreamT }).DigestStream;
  const digest = new DigestStream("SHA-256");
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      bytes += chunk.byteLength;
      ctl.enqueue(chunk);
    },
  });
  const hashDone = forHash.pipeThrough(counter).pipeTo(digest);
  const parser = new CsvStream(";", onRow, quote);
  const reader = forText.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(value);
  }
  parser.end();
  await hashDone;
  const sha = [...new Uint8Array(await digest.digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { sha, bytes, status: res.status };
}

async function recordStreamed(env: Env, a: { dataset: string; scope: string; url: string; sha: string; bytes: number; status: number; rows: number }) {
  const r = await env.DB.prepare(
    `INSERT INTO collection (source, dataset, scope, url, fetched_at, http_status, bytes, sha256, r2_key, rows)
     VALUES ('estado', ?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, ?8) RETURNING id`,
  )
    .bind(a.dataset, a.scope, a.url, nowIso(), a.status, a.bytes, a.sha, a.rows)
    .first<{ id: number }>();
  return r!.id;
}

/** "2009, 2010: Nome antigo; 2025, 2026: Nome atual" -> nome vigente no ano. */
export function orgaoName(raw: string, year: number): string {
  if (!raw.includes(":")) return raw.trim();
  const segs = raw.split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of segs) {
    const [years, ...rest] = s.split(":");
    if (years.split(",").map((y) => Number(y.trim())).includes(year)) return rest.join(":").trim();
  }
  const last = segs[segs.length - 1];
  return last.includes(":") ? last.split(":").slice(1).join(":").trim() : last;
}

const reais = (v: string) => Math.round(Number((v ?? "").replace(",", ".") || 0) * 100) || 0;
const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}/.test(v ?? "") ? v.slice(0, 10) : null);

export async function ingestEstadoEmpenhosYear(env: Env, year: number) {
  const url = EMPENHOS_URL[year];
  if (!url) return { year, skipped: "sem arquivo publicado" };
  const { results: gov } = await env.DB.prepare(
    `SELECT DISTINCT p.cpf FROM politician p JOIN candidacy c ON c.politician_id = p.id
      WHERE c.office IN ('GOVERNADOR', 'VICE-GOVERNADOR') AND c.elected = 1 AND p.cpf IS NOT NULL`,
  ).all<{ cpf: string }>();
  const govCpfs = new Set(gov.map((g) => g.cpf));

  let col: Record<string, number> | null = null;
  const payees = new Map<string, { year: number; doc: string; name: string; orgao: string; cents: number; n: number }>();
  const orgaos = new Map<string, { year: number; orgao: string; funcao: string; cents: number }>();
  const detail: Record<string, unknown>[] = [];
  let rows = 0;
  let malformed = 0;

  const meta = await streamCsv(url, "'", (r) => {
    if (!col) {
      col = Object.fromEntries(r.map((h, i) => [h.replace(/^﻿/, "").trim(), i]));
      for (const need of ["NUIDENTIFICACAO", "NMCREDOR", "NMORGAO", "VLEMPENHO", "NMTIPOEMPENHO"]) {
        if (!(need in col)) throw new Error(`empenhos ${year}: coluna ${need} ausente`);
      }
      return;
    }
    if (r.length !== Object.keys(col).length) return void malformed++;
    rows++;
    const g = (k: string) => (r[col![k]] ?? "").trim();
    const cents = reais(g("VLEMPENHO")); // já vem com sinal (anulação/estorno negativos)
    const orgao = orgaoName(g("NMORGAO"), year);
    const name = g("NMCREDOR");
    const d = digits(g("NUIDENTIFICACAO"));
    const doc = d.length === 14 || d.length === 11 ? d : `NOME:${normalizeName(name)}`;
    const key = `${doc}|${orgao}`;
    const p = payees.get(key);
    if (p) {
      p.cents += cents;
      p.n++;
    } else payees.set(key, { year, doc, name, orgao, cents, n: 1 });
    const funcao = g("NMFUNCAO") || "Não informada";
    const ok = `${orgao}|${funcao}`;
    const o = orgaos.get(ok);
    if (o) o.cents += cents;
    else orgaos.set(ok, { year, orgao, funcao, cents });

    if (FOCUS_ORGAO.test(orgao) || govCpfs.has(d)) {
      detail.push({
        year,
        issued_at: isoDate(g("DTLANCAMENTO")),
        nota: g("NUNOTAEMPENHO") || null,
        kind: g("NMTIPOEMPENHO") || null,
        history: g("DEHISTORICOEMPENHO").slice(0, 600) || null,
        modality: g("NMMODALIDADE") || null,
        contract: g("NUCONTRATO") || null,
        doc: d || null,
        name,
        orgao,
        ug: orgaoName(g("NMUNIDADEGESTORA"), year),
        funcao,
        action: orgaoName(g("NMSUBACAO") || g("NMACAO"), year) || null,
        element: g("NMSUBELEMENTO") || null,
        amount_cents: cents,
      });
    }
  });

  const collectionId = await recordStreamed(env, { dataset: "empenhos", scope: String(year), url, ...meta, rows });
  const withCol = (xs: Record<string, unknown>[]) => xs.map((x) => ({ ...x, collection_id: collectionId }));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM state_payee_year WHERE year = ?1").bind(year),
    env.DB.prepare("DELETE FROM state_orgao_year WHERE year = ?1").bind(year),
    env.DB.prepare("DELETE FROM state_empenho WHERE year = ?1").bind(year),
  ]);
  await insertJsonRows(
    env.DB,
    "state_payee_year",
    ["year", "doc", "name", "name_norm", "orgao", "committed_cents", "n", "collection_id"],
    withCol([...payees.values()].map((p) => ({ year: p.year, doc: p.doc, name: p.name, name_norm: normalizeName(p.name), orgao: p.orgao, committed_cents: p.cents, n: p.n }))),
  );
  await insertJsonRows(
    env.DB,
    "state_orgao_year",
    ["year", "orgao", "funcao", "committed_cents"],
    [...orgaos.values()].map((o) => ({ year: o.year, orgao: o.orgao, funcao: o.funcao, committed_cents: o.cents })),
  );
  await insertJsonRows(
    env.DB,
    "state_empenho",
    ["year", "issued_at", "nota", "kind", "history", "modality", "contract", "doc", "name", "orgao", "ug", "funcao", "action", "element", "amount_cents", "collection_id"],
    withCol(detail),
  );
  const total = [...payees.values()].reduce((s, p) => s + p.cents, 0);
  return { year, rows, malformed, payees: payees.size, detail: detail.length, total_cents: total, mb: Math.round(meta.bytes / 1e6) };
}

export async function ingestEstadoContratos(env: Env) {
  let col: Record<string, number> | null = null;
  const list: Record<string, unknown>[] = [];
  let malformed = 0;
  const meta = await streamCsv(CONTRATOS_URL, '"', (r) => {
    if (!col) {
      col = Object.fromEntries(r.map((h, i) => [h.replace(/^﻿/, "").trim(), i]));
      return;
    }
    if (r.length !== Object.keys(col).length) return void malformed++;
    const g = (k: string) => (r[col![k]] ?? "").trim();
    const signed = isoDate(g("DTASSINATURA"));
    if (!signed || signed < "2015") return; // histórico recente basta para os cruzamentos
    const d = digits(g("IDCONTRATADO"));
    list.push({
      ug: g("NMUNIDADEGESTORA") || null,
      number: g("NUCONTRATO") || null,
      doc: d.length === 14 || d.length === 11 ? d : null,
      name: g("CONTRATADO") || null,
      object: (g("OBJETO") || g("RESUMO")).slice(0, 600) || null,
      kind: g("DETIPOCONTRATO") || null,
      modality: g("NMMODALIDADE") || null,
      status: g("SITUACAO") || null,
      signed_at: signed,
      start_at: isoDate(g("DTINICIO")),
      end_at: isoDate(g("DTFIMATUAL")) ?? isoDate(g("DTFIM")),
      original_cents: reais(g("VLORIGINAL")),
      current_cents: reais(g("VLATUAL")),
    });
  });
  const collectionId = await recordStreamed(env, { dataset: "contratos", scope: nowIso().slice(0, 10), url: CONTRATOS_URL, ...meta, rows: list.length });
  await env.DB.prepare("DELETE FROM state_contract").run();
  await insertJsonRows(
    env.DB,
    "state_contract",
    ["ug", "number", "doc", "name", "object", "kind", "modality", "status", "signed_at", "start_at", "end_at", "original_cents", "current_cents", "collection_id"],
    list.map((c) => ({ ...c, collection_id: collectionId })),
  );
  return { contracts: list.length, malformed, mb: Math.round(meta.bytes / 1e6) };
}
