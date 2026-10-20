// Coletor: cadastro e quadro de sócios (QSA) da Receita Federal, via BrasilAPI.
// Incremental: a cada lote, busca CNPJs ainda não coletados (ou coletados há mais de
// um ano), priorizando quem recebe dinheiro público de políticos de SC.

import { digits, fetchRaw, insertJsonRows, normalizeName, nowIso, recordCollection } from "./util";

const API = (cnpj: string) => `https://brasilapi.com.br/api/cnpj/v1/${cnpj}`;
const CONCURRENCY = 3;

/** Próximos CNPJs a coletar, em ordem de prioridade. */
async function targets(env: Env, limit: number): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `WITH alvo AS (
       SELECT supplier_doc AS cnpj, sum(amount_cents) AS cents, 1 AS prio FROM fed_expense
        WHERE length(supplier_doc) = 14 GROUP BY supplier_doc
       UNION ALL
       SELECT doc, sum(amount_cents), 1 FROM emenda_favorecido
        WHERE length(doc) = 14 AND coalesce(natureza, '') NOT LIKE '%Munic%' AND coalesce(natureza, '') NOT LIKE '%Fundo%'
        GROUP BY doc
       UNION ALL
       SELECT doc, sum(paid_cents), 1 FROM alesc_payment WHERE doc IS NOT NULL AND subacao = '15915' GROUP BY doc
       UNION ALL
       SELECT supplier_doc, sum(amount_cents), 2 FROM campaign_expense WHERE length(supplier_doc) = 14 GROUP BY supplier_doc
     )
     SELECT cnpj FROM alvo
      -- Coletados: atualiza depois de um ano. Falhas: tenta de novo depois de uma semana.
      WHERE cnpj NOT IN (
        SELECT cnpj FROM company_registry
         WHERE fetched_at > date('now', CASE WHEN http_status IN (200, 404) THEN '-365 days' ELSE '-7 days' END))
      GROUP BY cnpj ORDER BY min(prio), sum(cents) DESC LIMIT ?1`,
  )
    .bind(limit)
    .all<{ cnpj: string }>();
  return results.map((r) => r.cnpj);
}

function parsePartners(cnpj: string, data: any, collectionId: number) {
  const out: Record<string, unknown>[] = [];
  for (const s of data?.qsa ?? []) {
    const name = String(s.nome_socio ?? "").trim();
    if (!name) continue;
    const raw = String(s.cnpj_cpf_do_socio ?? "").trim();
    const d = digits(raw);
    const isCompany = Number(s.identificador_de_socio) === 1 || (d.length >= 8 && !raw.includes("*"));
    out.push({
      cnpj,
      name,
      name_norm: normalizeName(name),
      doc_masked: raw || null,
      doc6: !isCompany && d.length === 6 ? d : null,
      root: isCompany ? d.slice(0, 8) || null : null,
      is_company: isCompany ? 1 : 0,
      role: s.qualificacao_socio ?? null,
      entered_at: s.data_entrada_sociedade ?? null,
      collection_id: collectionId,
    });
  }
  return out;
}

export async function ingestReceitaBatch(env: Env, limit: number) {
  const list = await targets(env, limit);
  let ok = 0;
  let notFound = 0;
  let failed = 0;
  let rateLimited = false;
  const registry: Record<string, unknown>[] = [];
  const partners: Record<string, unknown>[] = [];

  const work = async (cnpj: string) => {
    if (rateLimited) return;
    let raw;
    try {
      raw = await fetchRaw(API(cnpj), { headers: { Accept: "application/json" }, retries: 2, timeoutMs: 30_000 });
    } catch {
      failed++;
      registry.push({ cnpj, fetched_at: nowIso(), http_status: 0 });
      return;
    }
    if (raw.status === 429) {
      rateLimited = true;
      return;
    }
    if (raw.status === 404) {
      notFound++;
      registry.push({ cnpj, fetched_at: nowIso(), http_status: 404 });
      return;
    }
    if (raw.status !== 200) {
      failed++;
      registry.push({ cnpj, fetched_at: nowIso(), http_status: raw.status });
      return;
    }
    const data = JSON.parse(new TextDecoder().decode(raw.body));
    const collectionId = await recordCollection(env, { source: "receita", dataset: "cnpj", scope: cnpj, raw, ext: "json", rows: (data.qsa ?? []).length });
    registry.push({
      cnpj,
      name: data.razao_social ?? null,
      trade_name: data.nome_fantasia || null,
      status: data.descricao_situacao_cadastral ?? null,
      opened_at: data.data_inicio_atividade ?? null,
      cnae: data.cnae_fiscal_descricao ?? null,
      city: data.municipio ?? null,
      uf: data.uf ?? null,
      legal_nature: data.natureza_juridica ?? null,
      capital_cents: Math.round(Number(data.capital_social ?? 0) * 100),
      fetched_at: nowIso(),
      http_status: 200,
      collection_id: collectionId,
    });
    partners.push(...parsePartners(cnpj, data, collectionId));
    ok++;
  };

  for (let i = 0; i < list.length && !rateLimited; i += CONCURRENCY) {
    await Promise.all(list.slice(i, i + CONCURRENCY).map(work));
  }

  const done = registry.map((r) => r.cnpj as string);
  for (let i = 0; i < done.length; i += 90) {
    const chunk = done.slice(i, i + 90);
    const ph = chunk.map((_, j) => `?${j + 1}`).join(",");
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM company_partner WHERE cnpj IN (${ph})`).bind(...chunk),
      env.DB.prepare(`DELETE FROM company_registry WHERE cnpj IN (${ph})`).bind(...chunk),
    ]);
  }
  await insertJsonRows(
    env.DB,
    "company_registry",
    ["cnpj", "name", "trade_name", "status", "opened_at", "cnae", "city", "uf", "legal_nature", "capital_cents", "fetched_at", "http_status", "collection_id"],
    registry,
  );
  await insertJsonRows(
    env.DB,
    "company_partner",
    ["cnpj", "name", "name_norm", "doc_masked", "doc6", "root", "is_company", "role", "entered_at", "collection_id"],
    partners,
  );
  const remaining = (await env.DB.prepare("SELECT count(*) AS n FROM company_registry WHERE http_status = 200").first<{ n: number }>())?.n ?? 0;
  return { requested: list.length, ok, not_found: notFound, failed, rate_limited: rateLimited, partners: partners.length, total_collected: remaining };
}
