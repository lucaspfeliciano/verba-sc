// Coletor: PNCP (Portal Nacional de Contratações Públicas), contratos por órgão.
// API pública: https://pncp.gov.br/api/consulta/swagger-ui/index.html

import { brlToCents, digits, fetchRaw, insertJsonRows, recordCollection } from "./util";

export const PMF_CNPJ = "82892282000143";
const PAGE = 500;

export async function ingestPncpYear(env: Env, organCnpj: string, year: number) {
  const list: Record<string, unknown>[] = [];
  for (let page = 1; page < 200; page++) {
    const url =
      `https://pncp.gov.br/api/consulta/v1/contratos?dataInicial=${year}0101&dataFinal=${year}1231` +
      `&cnpjOrgao=${organCnpj}&pagina=${page}&tamanhoPagina=${PAGE}`;
    const raw = await fetchRaw(url, { headers: { Accept: "application/json" } });
    if (raw.status === 204) break;
    if (raw.status !== 200) throw new Error(`PNCP ${year} p${page}: HTTP ${raw.status}`);
    const data = JSON.parse(new TextDecoder().decode(raw.body)) as {
      data: any[];
      paginasRestantes: number;
    };
    const collectionId = await recordCollection(env, {
      source: "pncp",
      dataset: "contratos",
      scope: `${organCnpj}-${year}-p${page}`,
      raw,
      ext: "json",
      rows: data.data.length,
    });
    for (const c of data.data) {
      list.push({
        control_number: c.numeroControlePNCP,
        organ_cnpj: c.orgaoEntidade?.cnpj ?? organCnpj,
        unit_name: (c.unidadeOrgao?.nomeUnidade ?? "").trim() || null,
        year: c.anoContrato ?? year,
        supplier_doc: digits(c.niFornecedor) || null,
        supplier_name: (c.nomeRazaoSocialFornecedor ?? "").trim() || null,
        object: (c.objetoContrato ?? "").trim() || null,
        initial_cents: brlToCents(c.valorInicial ?? 0),
        global_cents: brlToCents(c.valorGlobal ?? 0),
        signed_at: c.dataAssinatura ?? null,
        valid_from: c.dataVigenciaInicio ?? null,
        valid_to: c.dataVigenciaFim ?? null,
        collection_id: collectionId,
      });
    }
    if (!data.paginasRestantes) break;
  }
  await insertJsonRows(
    env.DB,
    "pncp_contract",
    ["control_number", "organ_cnpj", "unit_name", "year", "supplier_doc", "supplier_name", "object", "initial_cents", "global_cents", "signed_at", "valid_from", "valid_to", "collection_id"],
    list,
    { onConflict: "OR REPLACE" },
  );
  return { organ: organCnpj, year, contracts: list.length };
}
