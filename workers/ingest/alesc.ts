// Coletor: ALESC, despesas dos gabinetes parlamentares (um CSV por ano, desde 2011).
// Fonte: https://transparencia.alesc.sc.gov.br/gabinetes-parlamentares/dados-abertos

import { brDateToIso, brlToCents, fetchRaw, insertJsonRows, normalizeName, recordCollection } from "./util";

export const ALESC_FIRST_YEAR = 2011;
const URL = (year: number) => `https://transparencia.alesc.sc.gov.br/gabinetes-parlamentares/csv/${year}`;
const EXPECTED_HEADER = ["Verba", "Descrição", "Conta", "Favorecido", "Trecho", "Data de Referência", "Valor"];

/** Parser de CSV com ';' e aspas duplas (RFC 4180 adaptado). */
export function parseCsv(text: string, sep = ";"): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

export async function ingestAlescYear(env: Env, year: number) {
  const raw = await fetchRaw(URL(year));
  if (raw.status !== 200) throw new Error(`ALESC ${year}: HTTP ${raw.status}`);
  const text = new TextDecoder("utf-8").decode(raw.body).replace(/^﻿/, "");
  const [header, ...lines] = parseCsv(text);
  if (header.join("|") !== EXPECTED_HEADER.join("|")) {
    throw new Error(`ALESC ${year}: cabeçalho inesperado: ${header.join(";")}`);
  }
  const rows = lines
    .filter((l) => l.length >= 7)
    .map(([category, description, account, payee, route, refDate, value]) => ({
      year,
      ref_date: brDateToIso(refDate),
      category: category.trim(),
      description: description.trim() || null,
      account: account.trim(),
      payee: payee.trim() || null,
      payee_norm: payee.trim() ? normalizeName(payee) : null,
      route: route.trim() || null,
      amount_cents: brlToCents(value),
    }));

  const collectionId = await recordCollection(env, {
    source: "alesc",
    dataset: "gabinetes",
    scope: String(year),
    raw,
    ext: "csv",
    rows: rows.length,
  });

  // Reescrita por recorte: o ano inteiro é substituído pela versão mais recente da fonte.
  await env.DB.prepare("DELETE FROM alesc_expense WHERE year = ?1").bind(year).run();
  await insertJsonRows(
    env.DB,
    "alesc_expense",
    ["year", "ref_date", "category", "description", "account", "payee", "payee_norm", "route", "amount_cents", "collection_id"],
    rows.map((r) => ({ ...r, collection_id: collectionId })),
  );
  const total = rows.reduce((s, r) => s + r.amount_cents, 0);
  return { year, rows: rows.length, total_cents: total, collection_id: collectionId };
}
