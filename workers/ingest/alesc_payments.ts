// Coletor: ALESC, pagamentos a credores (CSV anual, desde 2011).
// Fonte: https://transparencia.alesc.sc.gov.br/pagamentos/dados-abertos
//
// Diferente do CSV de gabinetes, este arquivo diz quem a Assembleia pagou de fato,
// com CPF/CNPJ. Só entram naturezas de compras, serviços e reembolsos: folha de
// pessoal, diárias de servidores e ressarcimentos médicos ficam de fora.

import { parseCsv } from "./alesc";
import { brlToCents, digits, fetchRaw, insertJsonRows, normalizeName, recordCollection } from "./util";

const URL = (year: number) => `https://transparencia.alesc.sc.gov.br/pagamentos/csv/${year}`;

/** Prefixos de natureza coletados (materiais, passagens, serviços PF/PJ, TIC, equipamentos). */
const KEEP_PREFIXES = ["339030", "339033", "339035", "339036", "339037", "339039", "339040", "449051", "449052"];
/** Restituições (reembolsos ao gabinete) e indenização por uso de veículo próprio. */
const KEEP_EXACT = new Set(["33909302", "33909310"]);

export function keepNatureza(n: string): boolean {
  return KEEP_EXACT.has(n) || KEEP_PREFIXES.some((p) => n.startsWith(p));
}

export async function ingestAlescPaymentsYear(env: Env, year: number) {
  const raw = await fetchRaw(URL(year));
  if (raw.status !== 200) throw new Error(`ALESC pagamentos ${year}: HTTP ${raw.status}`);
  const text = new TextDecoder("utf-8").decode(raw.body).replace(/^﻿/, "");
  const [header, ...lines] = parseCsv(text);
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`ALESC pagamentos ${year}: coluna ${name} ausente`);
    return i;
  };
  const c = {
    doc: col("CPF/CNPJ"),
    credor: col("CREDOR"),
    empenho: col("EMPENHO_NUMERO"),
    modality: col("EMPENHO_MODALIDADE"),
    subacao: col("EMPENHO_SUBACAO"),
    natureza: col("EMPENHO_NATUREZA"),
    subelemento: col("SUBELEMENTO"),
    complemento: col("EMPENHO_COMPLEMENTO"),
    liquidDoc: col("LIQUIDACAO_DOCUMENTO"),
    liquidDate: col("LIQUIDACAO_EMISSAO"),
    paidDate: col("PAGAMENTO_PAGAMENTO"),
    paid: col("PAGAMENTO_VALOR_PAGO"),
  };
  const rows = lines
    .filter((l) => l.length >= header.length - 1 && keepNatureza(l[c.natureza]))
    .filter((l) => !/m[eé]dic|odonto/i.test(l[c.subelemento]))
    .map((l) => {
      const docFmt = l[c.doc].trim();
      const d = digits(docFmt);
      const comp = l[c.complemento].trim();
      return {
        year,
        doc: d.length === 14 ? d : null,
        doc_fmt: docFmt || null,
        credor: l[c.credor].trim(),
        credor_norm: normalizeName(l[c.credor]),
        empenho: l[c.empenho] || null,
        modality: l[c.modality] || null,
        subacao: l[c.subacao] || null,
        natureza: l[c.natureza],
        subelemento: l[c.subelemento].trim() || null,
        complemento: comp || null,
        complemento_norm: comp ? normalizeName(comp) : null,
        liquid_doc: l[c.liquidDoc].trim() || null,
        liquid_date: l[c.liquidDate] || null,
        paid_date: l[c.paidDate] || null,
        paid_cents: brlToCents(l[c.paid]),
      };
    });

  const collectionId = await recordCollection(env, {
    source: "alesc",
    dataset: "pagamentos",
    scope: String(year),
    raw,
    ext: "csv",
    rows: rows.length,
  });
  await env.DB.prepare("DELETE FROM alesc_payment WHERE year = ?1").bind(year).run();
  await insertJsonRows(
    env.DB,
    "alesc_payment",
    ["year", "doc", "doc_fmt", "credor", "credor_norm", "empenho", "modality", "subacao", "natureza", "subelemento", "complemento", "complemento_norm", "liquid_doc", "liquid_date", "paid_date", "paid_cents", "collection_id"],
    rows.map((r) => ({ ...r, collection_id: collectionId })),
  );
  return { year, rows: rows.length, paid_cents: rows.reduce((s, r) => s + r.paid_cents, 0), skipped: lines.length - rows.length };
}
