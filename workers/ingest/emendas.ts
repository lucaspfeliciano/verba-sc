// Coletor: emendas parlamentares federais (Portal da Transparência, CGU).
// O arquivo único cobre todo o país e todo o histórico (~32 MB compactado,
// ~250 MB de CSV). É lido em fluxo; ficam só as emendas cujo autor é um
// deputado federal ou senador de SC (pelo nome parlamentar) ou a bancada de SC.

import { CsvStream, unzipEach } from "./csvstream";
import { brlToCents, digits, fetchRaw, insertJsonRows, normalizeName, recordCollection } from "./util";

const URL = "https://portaldatransparencia.gov.br/download-de-dados/emendas-parlamentares/UNICO";
export const SC_BANCADA = "BANCADA DE SANTA CATARINA";

/** Cabeçalho -> índice, sem depender de acentos ("Código da Emenda" -> "CODIGO DA EMENDA"). */
function headerIndex(h: string[]) {
  const idx = new Map(h.map((name, i) => [normalizeName(name), i]));
  return (name: string) => {
    const i = idx.get(normalizeName(name));
    if (i === undefined) throw new Error(`emendas: coluna "${name}" ausente`);
    return i;
  };
}

const nul = (s: string | undefined) => {
  const v = (s ?? "").trim();
  return !v || /^sem informa/i.test(v) || v === "S/I" ? null : v;
};

export async function ingestEmendas(env: Env) {
  // Autores de interesse: nome parlamentar dos deputados federais e senadores de SC.
  const { results } = await env.DB.prepare("SELECT DISTINCT name FROM fed_member UNION SELECT DISTINCT full_name FROM fed_member WHERE full_name IS NOT NULL").all<{ name: string }>();
  const authors = new Set(results.map((r) => normalizeName(r.name)).filter(Boolean));
  authors.add(SC_BANCADA);

  const raw = await fetchRaw(URL, { timeoutMs: 300_000 });
  if (raw.status !== 200) throw new Error(`emendas: HTTP ${raw.status}`);

  const emendas: Record<string, unknown>[] = [];
  const favorecidos: Record<string, unknown>[] = [];
  const convenios: Record<string, unknown>[] = [];
  const codes = new Set<string>();
  const pending: Record<string, unknown>[] = []; // convênios lidos antes das emendas (se a ordem do zip mudar)

  const parsers: Record<string, () => CsvStream> = {
    "EmendasParlamentares.csv": () => {
      let col: ((n: string) => number) | null = null;
      return new CsvStream(";", (r) => {
        if (!col) return void (col = headerIndex(r));
        const author = normalizeName(r[col("Nome do Autor da Emenda")]);
        if (!authors.has(author)) return;
        const code = r[col("Código da Emenda")].trim();
        if (!code || /^sem/i.test(code)) return;
        codes.add(code);
        emendas.push({
          code,
          year: Number(r[col("Ano da Emenda")]) || 0,
          type: nul(r[col("Tipo de Emenda")]),
          author_code: nul(r[col("Código do Autor da Emenda")]),
          author_name: r[col("Nome do Autor da Emenda")].trim(),
          author_norm: author,
          number: nul(r[col("Número da emenda")]),
          locality: nul(r[col("Localidade de aplicação do recurso")]),
          municipio_ibge: nul(r[col("Código Município IBGE")]),
          municipio: nul(r[col("Município")]),
          uf: nul(r[col("UF")]),
          funcao: nul(r[col("Nome Função")]),
          programa: nul(r[col("Nome Programa")]),
          acao: nul(r[col("Nome Ação")]),
          committed_cents: brlToCents(r[col("Valor Empenhado")]),
          liquidated_cents: brlToCents(r[col("Valor Liquidado")]),
          paid_cents: brlToCents(r[col("Valor Pago")]),
          rp_paid_cents: brlToCents(r[col("Valor Restos A Pagar Pagos")]),
        });
      });
    },
    "EmendasParlamentares_PorFavorecido.csv": () => {
      let col: ((n: string) => number) | null = null;
      return new CsvStream(";", (r) => {
        if (!col) return void (col = headerIndex(r));
        const author = normalizeName(r[col("Nome do Autor da Emenda")]);
        if (!authors.has(author)) return;
        const doc = digits(r[col("Código do Favorecido")]);
        const name = nul(r[col("Favorecido")]);
        favorecidos.push({
          code: r[col("Código da Emenda")].trim(),
          author_norm: author,
          year_month: nul(r[col("Ano/Mês")]),
          doc: doc.length === 14 || doc.length === 11 ? doc : null,
          name,
          name_norm: name ? normalizeName(name) : null,
          natureza: nul(r[col("Natureza Jurídica")]),
          kind: nul(r[col("Tipo Favorecido")]),
          uf: nul(r[col("UF Favorecido")]),
          municipio: nul(r[col("Município Favorecido")]),
          amount_cents: brlToCents(r[col("Valor Recebido")]),
        });
      });
    },
    "EmendasParlamentares_Convenios.csv": () => {
      let col: ((n: string) => number) | null = null;
      return new CsvStream(";", (r) => {
        if (!col) return void (col = headerIndex(r));
        const pub = (r[col("Data Publicação Convênio")] ?? "").trim();
        const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(pub);
        pending.push({
          code: r[col("Código da Emenda")].trim(),
          convenente: nul(r[col("Convenente")]),
          objeto: nul(r[col("Objeto Convênio")]),
          numero: nul(r[col("Número Convênio")]),
          published_at: m ? `${m[3]}-${m[2]}-${m[1]}` : null,
          locality: nul(r[col("Localidade do gasto")]),
          amount_cents: brlToCents(r[col("Valor Convênio")]),
        });
        // Mantém a memória sob controle: descarta o que já se sabe não ser de SC.
        if (pending.length > 5000 && codes.size > 0) {
          for (const c of pending.splice(0)) if (codes.has(c.code as string)) convenios.push(c);
        }
      });
    },
  };

  const streams = new Map<string, CsvStream>();
  const seen = unzipEach(
    raw.body,
    (name) => {
      const make = parsers[name];
      if (!make) return null;
      const s = make();
      streams.set(name, s);
      return (t) => s.push(t);
    },
    "latin1",
  );
  for (const s of streams.values()) s.end();
  for (const c of pending) if (codes.has(c.code as string)) convenios.push(c);
  if (!seen.includes("EmendasParlamentares.csv")) throw new Error(`emendas: arquivo principal ausente (${seen.join(", ")})`);

  const collectionId = await recordCollection(env, { source: "cgu", dataset: "emendas", scope: "unico", raw, ext: "zip", rows: emendas.length });
  const withCol = (rows: Record<string, unknown>[]) => rows.map((r) => ({ ...r, collection_id: collectionId }));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM emenda_favorecido"),
    env.DB.prepare("DELETE FROM emenda_convenio"),
    env.DB.prepare("DELETE FROM emenda"),
  ]);
  await insertJsonRows(
    env.DB,
    "emenda",
    ["code", "year", "type", "author_code", "author_name", "author_norm", "number", "locality", "municipio_ibge", "municipio", "uf", "funcao", "programa", "acao", "committed_cents", "liquidated_cents", "paid_cents", "rp_paid_cents", "collection_id"],
    withCol(emendas),
    { onConflict: "OR REPLACE" },
  );
  await insertJsonRows(
    env.DB,
    "emenda_favorecido",
    ["code", "author_norm", "year_month", "doc", "name", "name_norm", "natureza", "kind", "uf", "municipio", "amount_cents", "collection_id"],
    withCol(favorecidos),
  );
  await insertJsonRows(env.DB, "emenda_convenio", ["code", "convenente", "objeto", "numero", "published_at", "locality", "amount_cents", "collection_id"], withCol(convenios));
  return {
    emendas: emendas.length,
    favorecidos: favorecidos.length,
    convenios: convenios.length,
    autores: new Set(emendas.map((e) => e.author_norm)).size,
    files: seen,
  };
}
