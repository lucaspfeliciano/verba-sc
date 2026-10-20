// Utilitários compartilhados pelos coletores.

export const UA = "verba-sc/0.1 (transparencia; +https://verba-sc.workers.dev/sobre)";

export function nowIso(): string {
  return new Date().toISOString();
}

export function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D+/g, "");
}

/** "1.234,56" -> 123456. Aceita também número JS (reais). */
export function brlToCents(v: string | number | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Math.round(v * 100);
  const n = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** "31/01/2025" -> "2025-01-31". */
export function brDateToIso(s: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const NOISE_TOKENS = new Set(["LTDA", "LTD", "ME", "EPP", "EIRELI", "MEI", "SA", "SS"]);

/**
 * Normalização de nomes para cruzamento. Precisa ser idêntica a
 * pipeline/tse_sc.py:normalize_name — os dois lados geram chaves comparáveis.
 */
export function normalizeName(s: string | null | undefined): string {
  const base = (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\bS\s*\/\s*A\b/g, "SA")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
  const tokens = base.split(" ").filter(Boolean);
  // Nome de MEI costuma vir prefixado pela raiz do CNPJ ("45 672 070 FULANO").
  while (tokens.length > 1 && /^\d+$/.test(tokens[0])) tokens.shift();
  return tokens.filter((t) => !NOISE_TOKENS.has(t)).join(" ");
}

export async function sha256Hex(data: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface FetchedRaw {
  url: string;
  status: number;
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
  requestBody?: string;
}

export async function fetchRaw(
  url: string,
  init: RequestInit & { retries?: number; timeoutMs?: number } = {},
): Promise<FetchedRaw> {
  const { retries = 3, timeoutMs = 120_000, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...rest,
        headers: { "User-Agent": UA, Accept: "*/*", ...(rest.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status} em ${url}`);
      return {
        url,
        status: res.status,
        body,
        contentType: res.headers.get("content-type") ?? "",
        requestBody: typeof rest.body === "string" ? rest.body : undefined,
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Grava a cópia bruta no R2 e registra a coleta. A chave no R2 inclui o hash,
 * então o mesmo conteúdo baixado duas vezes não duplica armazenamento.
 */
export async function recordCollection(
  env: Env,
  args: { source: string; dataset: string; scope: string; raw: FetchedRaw; ext: string; rows: number },
): Promise<number> {
  const { source, dataset, scope, raw, ext, rows } = args;
  const sha = await sha256Hex(raw.body);
  const r2Key = `${source}/${dataset}/${scope}/${sha}.${ext}`;
  const existing = await env.RAW.head(r2Key);
  if (!existing) {
    await env.RAW.put(r2Key, raw.body, {
      httpMetadata: { contentType: raw.contentType || "application/octet-stream" },
      customMetadata: { url: raw.url, fetched_at: nowIso() },
    });
  }
  const res = await env.DB.prepare(
    `INSERT INTO collection (source, dataset, scope, url, request_body, fetched_at, http_status, bytes, sha256, r2_key, rows)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
  )
    .bind(source, dataset, scope, raw.url, raw.requestBody ?? null, nowIso(), raw.status, raw.body.byteLength, sha, r2Key, rows)
    .first<{ id: number }>();
  return res!.id;
}

/**
 * Insere muitas linhas com poucas consultas: cada lote vira um único parâmetro
 * JSON expandido por json_each (contorna o limite de 100 parâmetros e de
 * 1.000 consultas por invocação do D1).
 */
export async function insertJsonRows(
  db: D1Database,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[],
  opts: { onConflict?: string; maxBytes?: number } = {},
): Promise<number> {
  if (rows.length === 0) return 0;
  const maxBytes = opts.maxBytes ?? 900_000;
  const select = columns.map((c) => `json_extract(value, '$.${c}')`).join(", ");
  const sql = `INSERT ${opts.onConflict ?? ""} INTO ${table} (${columns.join(", ")}) SELECT ${select} FROM json_each(?1)`;
  const stmts: { stmt: D1PreparedStatement; size: number }[] = [];
  let chunk: string[] = [];
  let size = 2;
  const flush = () => {
    if (chunk.length) stmts.push({ stmt: db.prepare(sql).bind(`[${chunk.join(",")}]`), size });
    chunk = [];
    size = 2;
  };
  for (const row of rows) {
    const s = JSON.stringify(row);
    if (size + s.length > maxBytes) flush();
    chunk.push(s);
    size += s.length + 1;
  }
  flush();
  // Cada batch precisa terminar em 30 s e caber no limite de 32 MiB por chamada ao D1
  // (o tamanho serializado chega a ~2x o número de caracteres): até 20 instruções e ~6 M caracteres.
  let batch: D1PreparedStatement[] = [];
  let batchSize = 0;
  for (const s of stmts) {
    if (batch.length && (batch.length >= 20 || batchSize + s.size > 6_000_000)) {
      await db.batch(batch);
      batch = [];
      batchSize = 0;
    }
    batch.push(s.stmt);
    batchSize += s.size;
  }
  if (batch.length) await db.batch(batch);
  return rows.length;
}
