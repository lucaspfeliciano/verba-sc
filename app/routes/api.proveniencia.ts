// GET /api/proveniencia?ref=d:alesc/gabinetes/2025&ref=c:123
// Devolve as coletas (arquivos oficiais baixados) por trás de um dado exibido no site.
import { all } from "~/lib/db.server";
import { SOURCES } from "~/lib/sources";
import type { Route } from "./+types/api.proveniencia";

interface Row {
  id: number;
  source: string;
  dataset: string;
  scope: string;
  url: string;
  fetched_at: string;
  http_status: number | null;
  bytes: number | null;
  sha256: string;
  r2_key: string | null;
  rows: number | null;
}

const FIELDS = "id, source, dataset, scope, url, fetched_at, http_status, bytes, sha256, r2_key, rows";

export async function loader({ request }: Route.LoaderArgs) {
  const refs = new URL(request.url).searchParams.getAll("ref").slice(0, 8);
  const found = new Map<number, Row>();
  const totals: Record<string, number> = {};
  for (const ref of refs) {
    if (ref.startsWith("c:")) {
      const id = Number(ref.slice(2));
      if (!id) continue;
      for (const r of await all<Row>(`SELECT ${FIELDS} FROM collection WHERE id = ?1`, id)) found.set(r.id, r);
    } else if (ref.startsWith("d:")) {
      const [source, dataset, ...rest] = ref.slice(2).split("/");
      if (!source || !dataset) continue;
      const scope = rest.join("/");
      // Para cada recorte, só a coleta mais recente (é a que está no banco).
      const rows = await all<Row>(
        `SELECT ${FIELDS} FROM collection c
          WHERE source = ?1 AND dataset = ?2 AND scope LIKE ?3
            AND id = (SELECT max(id) FROM collection x WHERE x.source = c.source AND x.dataset = c.dataset AND x.scope = c.scope)
          ORDER BY fetched_at DESC, scope LIMIT 24`,
        source,
        dataset,
        `${scope}%`,
      );
      const n = await all<{ n: number }>(
        `SELECT count(DISTINCT scope) AS n FROM collection WHERE source = ?1 AND dataset = ?2 AND scope LIKE ?3`,
        source,
        dataset,
        `${scope}%`,
      );
      totals[ref] = n[0]?.n ?? rows.length;
      for (const r of rows) found.set(r.id, r);
    }
  }
  const items = [...found.values()].map((r) => {
    const meta = SOURCES[r.source];
    return {
      ...r,
      source_name: meta?.name ?? r.source,
      agency: meta?.agency ?? null,
      home: meta?.home ?? null,
      legal: meta?.legal ?? null,
      dataset_label: meta?.datasets[r.dataset] ?? r.dataset,
      download: r.r2_key ? `/bruto/${r.r2_key}` : null,
    };
  });
  return Response.json(
    { items, totals },
    { headers: { "Cache-Control": "public, max-age=600" } },
  );
}
