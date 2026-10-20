import { createRequestHandler } from "react-router";

import type { IngestParams } from "./ingest/workflow";

export { IngestWorkflow } from "./ingest/workflow";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

function authorized(request: Request, env: Env): boolean {
  const token = (env as unknown as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;
  return !!token && request.headers.get("Authorization") === `Bearer ${token}`;
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  if (!authorized(request, env)) return new Response("unauthorized", { status: 401 });
  if (url.pathname === "/admin/ingest" && request.method === "POST") {
    const params = (await request.json().catch(() => ({}))) as IngestParams;
    const instance = await env.INGEST.create({ params });
    return Response.json({ id: instance.id });
  }
  const m = /^\/admin\/ingest\/([\w-]+)$/.exec(url.pathname);
  if (m) {
    const instance = await env.INGEST.get(m[1]);
    return Response.json(await instance.status());
  }
  return new Response("not found", { status: 404 });
}

/** Cópia bruta de um arquivo oficial. Só serve chaves registradas em `collection`. */
async function handleRaw(env: Env, url: URL): Promise<Response> {
  const key = decodeURIComponent(url.pathname.slice("/bruto/".length));
  const known = await env.DB.prepare("SELECT url, sha256 FROM collection WHERE r2_key = ?1 LIMIT 1")
    .bind(key)
    .first<{ url: string; sha256: string }>();
  if (!known) return new Response("não encontrado", { status: 404 });
  const obj = await env.RAW.get(key);
  if (!obj) return new Response("não encontrado", { status: 404 });
  const name = key.split("/").slice(0, -1).join("_") + "." + key.split(".").pop();
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Source-Url": known.url,
      "X-Sha256": known.sha256,
    },
  });
}

// Os dados mudam uma vez por dia; uma hora de cache poupa o D1 e deixa as páginas rápidas.
const PAGE_TTL = 3600;

async function cachedPage(request: Request, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" || import.meta.env.DEV) return requestHandler(request);
  // Os tipos do DOM (usados pelo app React) escondem o `caches.default` dos Workers.
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await requestHandler(request);
  if (res.status !== 200 || res.headers.has("Set-Cookie")) return res;
  const out = new Response(res.body, res);
  out.headers.set("Cache-Control", `public, max-age=300, s-maxage=${PAGE_TTL}`);
  ctx.waitUntil(cache.put(request, out.clone()));
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/admin/")) return handleAdmin(request, env, url);
    if (url.pathname.startsWith("/bruto/")) return handleRaw(env, url);
    return cachedPage(request, ctx);
  },
} satisfies ExportedHandler<Env>;
