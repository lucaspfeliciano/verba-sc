// Ciclos de dinheiro: grafo dirigido de quem paga quem (campanha e dinheiro público),
// componentes fortemente conexos por Tarjan e busca de ciclos simples curtos.
//
// Nós: políticos (P:<id>, juntando CPF e CNPJs de campanha) e demais CPF/CNPJ (D:<doc>).
// Arestas (dinheiro saindo -> entrando):
//   doação          doador -> político                       (TSE, receitas)
//   campanha        político -> fornecedor da campanha       (TSE, despesas)
//   cota            parlamentar federal -> fornecedor        (Câmara/Senado)
//   emenda          parlamentar -> favorecido da emenda      (CGU)
//   gabinete        deputado estadual -> credor com CNPJ     (ALESC, pagamentos a credores)
//
// Um ciclo é um caminho que volta ao ponto de partida: A paga B, B paga C, C paga A.
// Ciclos podem ser legítimos (ex.: partido financia candidato e recebe as sobras).

import { insertJsonRows, normalizeName, nowIso, sha256Hex } from "./util";

export const MAX_CYCLE_NODES = 5;
export const MIN_CYCLE_CENTS = 1_000_000; // R$ 10 mil movimentados no ciclo
const MAX_FANOUT = 400; // nós com mais saídas que isso são "hubs" e não são expandidos
const MAX_CYCLES = 50_000;
const MAX_STORED = 3_000;

export type EdgeKind = "doacao" | "campanha" | "cota" | "emenda" | "gabinete";
const PUBLIC_KINDS = new Set<EdgeKind>(["cota", "emenda", "gabinete"]);

const PARTY = /\b(PARTIDO|DIRECAO|DIRETORIO|COMISSAO PROVISORIA|ORGAO DE DIRECAO|ELEICAO \d{4})\b/;

interface NodeInfo {
  key: string;
  label: string;
  kind: "politico" | "partido" | "empresa" | "pessoa";
  slug?: string;
  doc?: string;
}

/** Tarjan iterativo: devolve os componentes fortemente conexos. */
export function tarjan(n: number, adj: number[][]): number[][] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const stack: number[] = [];
  const out: number[][] = [];
  let next = 0;
  for (let s = 0; s < n; s++) {
    if (index[s] !== -1) continue;
    const work: [number, number][] = [[s, 0]];
    index[s] = low[s] = next++;
    stack.push(s);
    onStack[s] = 1;
    while (work.length) {
      const top = work[work.length - 1];
      const v = top[0];
      const nb = adj[v];
      if (top[1] < nb.length) {
        const w = nb[top[1]++];
        if (index[w] === -1) {
          index[w] = low[w] = next++;
          stack.push(w);
          onStack[w] = 1;
          work.push([w, 0]);
        } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
      } else {
        work.pop();
        if (work.length) {
          const u = work[work.length - 1][0];
          low[u] = Math.min(low[u], low[v]);
        }
        if (low[v] === index[v]) {
          const comp: number[] = [];
          let w: number;
          do {
            w = stack.pop()!;
            onStack[w] = 0;
            comp.push(w);
          } while (w !== v);
          out.push(comp);
        }
      }
    }
  }
  return out;
}

/** Ciclos simples de até `maxNodes` nós dentro de um componente; cada ciclo sai do seu menor índice. */
function cyclesIn(comp: number[], adj: number[][], maxNodes: number, found: number[][], state: { hubs: number }) {
  const members = new Set(comp);
  const sub = new Map<number, number[]>();
  for (const v of comp) sub.set(v, adj[v].filter((w) => members.has(w)));
  const sorted = [...comp].sort((a, b) => a - b);
  for (const start of sorted) {
    if (found.length >= MAX_CYCLES) return;
    const path = [start];
    const seen = new Set([start]);
    const dfs = (v: number) => {
      if (found.length >= MAX_CYCLES) return;
      const nb = sub.get(v)!;
      if (v !== start && nb.length > MAX_FANOUT) {
        state.hubs++;
        return;
      }
      for (const w of nb) {
        if (w === start && path.length >= 2) found.push([...path]);
        else if (w > start && !seen.has(w) && path.length < maxNodes) {
          seen.add(w);
          path.push(w);
          dfs(w);
          path.pop();
          seen.delete(w);
        }
      }
    };
    dfs(start);
  }
}

export async function computeCycles(env: Env) {
  const db = env.DB;
  // --- Identidade: documentos que pertencem a um político (CPF e CNPJs de campanha).
  const { results: idRows } = await db
    .prepare(
      `SELECT p.id, p.slug, p.ballot_name, p.cpf, c.campaign_cnpj FROM politician p LEFT JOIN candidacy c ON c.politician_id = p.id`,
    )
    .all<{ id: string; slug: string; ballot_name: string; cpf: string | null; campaign_cnpj: string | null }>();
  const docToPol = new Map<string, string>();
  const info = new Map<string, NodeInfo>();
  for (const r of idRows) {
    if (r.cpf) docToPol.set(r.cpf, r.id);
    if (r.campaign_cnpj) docToPol.set(r.campaign_cnpj, r.id);
    info.set(`P:${r.id}`, { key: `P:${r.id}`, label: r.ballot_name, kind: "politico", slug: r.slug });
  }
  const nodeOf = (doc: string, name: string | null) => {
    const pid = docToPol.get(doc);
    if (pid) return `P:${pid}`;
    const key = `D:${doc}`;
    if (!info.has(key)) {
      const label = (name ?? "").trim() || "Não identificado";
      const party = PARTY.test(normalizeName(label));
      info.set(key, { key, label, kind: party ? "partido" : doc.length === 11 ? "pessoa" : "empresa", doc });
    }
    return key;
  };

  // --- Arestas agregadas por (origem, destino, tipo).
  const edges = new Map<string, { from: string; to: string; kind: EdgeKind; cents: number }>();
  const intermediaries = new Set<string>();
  const add = (from: string, to: string, kind: EdgeKind, cents: number) => {
    if (from === to || cents <= 0) return;
    const k = `${from}|${to}|${kind}`;
    const e = edges.get(k);
    if (e) e.cents += cents;
    else edges.set(k, { from, to, kind, cents });
  };

  const years = (await db.prepare("SELECT DISTINCT year FROM candidacy ORDER BY year").all<{ year: number }>()).results.map((r) => r.year);
  for (const y of years) {
    const { results: rec } = await db
      .prepare(
        `SELECT r.donor_doc AS doc, max(r.donor_name) AS name, c.politician_id AS pid, sum(r.amount_cents) AS cents
           FROM campaign_receipt r JOIN candidacy c ON c.sq_candidato = r.sq_candidato
          WHERE c.year = ?1 AND length(r.donor_doc) IN (11, 14) GROUP BY r.donor_doc, c.politician_id`,
      )
      .bind(y)
      .all<{ doc: string; name: string | null; pid: string; cents: number }>();
    for (const r of rec) {
      const from = nodeOf(r.doc, r.name);
      // Empresas não podem doar desde 2015: "doação" de CNPJ que não é partido nem campanha
      // é repasse de intermediário (plataforma de financiamento coletivo), não origem do dinheiro.
      if (info.get(from)?.kind === "empresa") {
        intermediaries.add(from);
        continue;
      }
      add(from, `P:${r.pid}`, "doacao", r.cents);
    }
    const { results: exp } = await db
      .prepare(
        `SELECT e.supplier_doc AS doc, max(e.supplier_name) AS name, c.politician_id AS pid, sum(e.amount_cents) AS cents
           FROM campaign_expense e JOIN candidacy c ON c.sq_candidato = e.sq_candidato
          WHERE c.year = ?1 AND length(e.supplier_doc) IN (11, 14) GROUP BY e.supplier_doc, c.politician_id`,
      )
      .bind(y)
      .all<{ doc: string; name: string | null; pid: string; cents: number }>();
    for (const r of exp) add(`P:${r.pid}`, nodeOf(r.doc, r.name), "campanha", r.cents);
  }

  const { results: cota } = await db
    .prepare(
      `SELECT l.politician_id AS pid, e.supplier_doc AS doc, max(e.supplier_name) AS name, sum(e.amount_cents) AS cents
         FROM fed_expense e JOIN mandate_link l ON l.source = e.house AND l.alias = e.member_id
        WHERE length(e.supplier_doc) IN (11, 14) GROUP BY l.politician_id, e.supplier_doc`,
    )
    .all<{ pid: string; doc: string; name: string | null; cents: number }>();
  for (const r of cota) add(`P:${r.pid}`, nodeOf(r.doc, r.name), "cota", r.cents);

  const { results: em } = await db
    .prepare(
      `SELECT l.politician_id AS pid, f.doc, max(f.name) AS name, sum(f.amount_cents) AS cents
         FROM emenda_favorecido f JOIN mandate_link l ON l.source = 'emenda' AND l.alias = f.author_norm
        WHERE f.doc IS NOT NULL GROUP BY l.politician_id, f.doc`,
    )
    .all<{ pid: string; doc: string; name: string | null; cents: number }>();
  for (const r of em) add(`P:${r.pid}`, nodeOf(r.doc, r.name), "emenda", r.cents);

  // ALESC: credores com CNPJ atribuídos ao gabinete (sem as restituições ao próprio deputado).
  const { results: gab } = await db
    .prepare(
      `SELECT l.politician_id AS pid, p.doc, max(p.credor) AS name, sum(p.paid_cents) AS cents
         FROM alesc_payment p JOIN mandate_link l ON l.source = 'alesc_comp' AND l.alias = p.complemento
        WHERE p.doc IS NOT NULL AND p.natureza NOT IN ('33909302', '33909310') GROUP BY l.politician_id, p.doc`,
    )
    .all<{ pid: string; doc: string; name: string | null; cents: number }>();
  for (const r of gab) add(`P:${r.pid}`, nodeOf(r.doc, r.name), "gabinete", r.cents);

  // --- Grafo indexado. Arestas paralelas de tipos diferentes viram uma só para a busca.
  const keys = new Map<string, number>();
  const names: string[] = [];
  const id = (k: string) => {
    let i = keys.get(k);
    if (i === undefined) {
      i = names.length;
      keys.set(k, i);
      names.push(k);
    }
    return i;
  };
  const pair = new Map<string, { kinds: Map<EdgeKind, number>; cents: number }>();
  for (const e of edges.values()) {
    const a = id(e.from);
    const b = id(e.to);
    const k = `${a}>${b}`;
    const p = pair.get(k) ?? { kinds: new Map(), cents: 0 };
    p.kinds.set(e.kind, (p.kinds.get(e.kind) ?? 0) + e.cents);
    p.cents += e.cents;
    pair.set(k, p);
  }
  const adj: number[][] = Array.from({ length: names.length }, () => []);
  for (const k of pair.keys()) {
    const [a, b] = k.split(">").map(Number);
    adj[a].push(b);
  }

  const comps = tarjan(names.length, adj).filter((c) => c.length > 1);
  const found: number[][] = [];
  const state = { hubs: 0 };
  for (const c of comps.sort((a, b) => a.length - b.length)) cyclesIn(c, adj, MAX_CYCLE_NODES, found, state);

  // --- Pontuação e gravação como sinais.
  const createdAt = nowIso();
  const scored = found
    .map((cyc) => {
      const steps = cyc.map((v, i) => {
        const w = cyc[(i + 1) % cyc.length];
        const p = pair.get(`${v}>${w}`)!;
        return { from: names[v], to: names[w], cents: p.cents, kinds: [...p.kinds.entries()].map(([kind, cents]) => ({ kind, cents })) };
      });
      const total = steps.reduce((s, e) => s + e.cents, 0);
      const minEdge = Math.min(...steps.map((e) => e.cents));
      const nodes = cyc.map((v) => info.get(names[v])!);
      const hasParty = nodes.some((n) => n.kind === "partido");
      const hasPublic = steps.some((e) => e.kinds.some((k) => PUBLIC_KINDS.has(k.kind)));
      const politicians = nodes.filter((n) => n.kind === "politico").length;
      const onlyPoliticians = politicians === nodes.length;
      // Partido <-> candidato e doações entre candidatos são fluxos comuns e, em geral, legais.
      // O que pode ter dado a volta completa é limitado pela menor aresta (gargalo).
      const severity =
        hasParty || onlyPoliticians || minEdge < 100_000
          ? "low"
          : (cyc.length <= 3 || hasPublic) && minEdge >= 500_000
            ? "high"
            : "medium";
      return { cyc, steps, total, minEdge, nodes, hasParty, hasPublic, politicians, severity };
    })
    .filter((c) => c.total >= MIN_CYCLE_CENTS && c.politicians > 0)
    .sort((a, b) => {
      const rank = (c: typeof a) => (c.severity === "high" ? 0 : c.severity === "medium" ? 1 : 2);
      return rank(a) - rank(b) || Number(b.hasPublic) - Number(a.hasPublic) || b.minEdge - a.minEdge || b.total - a.total;
    });

  const stored = scored.slice(0, MAX_STORED);
  const KIND_LABEL: Record<EdgeKind, string> = { doacao: "doação", campanha: "pagamento de campanha", cota: "cota parlamentar", emenda: "emenda", gabinete: "verba de gabinete" };
  const brl = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const rows: Record<string, unknown>[] = [];
  for (const c of stored) {
    // Começa o desenho pelo primeiro político do ciclo.
    const first = Math.max(0, c.nodes.findIndex((n) => n.kind === "politico"));
    const nodes = [...c.nodes.slice(first), ...c.nodes.slice(0, first)];
    const steps = [...c.steps.slice(first), ...c.steps.slice(0, first)];
    const label = (n: NodeInfo) => n.label.length > 40 ? `${n.label.slice(0, 38)}…` : n.label;
    const pol = nodes.find((n) => n.kind === "politico");
    rows.push({
      key: (await sha256Hex(["ciclo", ...[...c.cyc].map((v) => names[v]).sort()].join("|"))).slice(0, 12),
      rule: "ciclo_dinheiro",
      rule_version: "1",
      severity: c.severity,
      title: `Ciclo de ${nodes.length} participantes: ${nodes.map(label).join(" → ")} → ${label(nodes[0])}`,
      detail:
        steps.map((s) => `${label(info.get(s.from)!)} → ${label(info.get(s.to)!)}: ${brl(s.cents)} (${s.kinds.map((k) => KIND_LABEL[k.kind]).join(" e ")})`).join("; ") +
        `. Total movimentado: ${brl(c.total)}; no máximo ${brl(c.minEdge)} podem ter dado a volta completa (a menor ligação).` +
        (c.hasParty ? " Envolve partido: repasses entre partido e candidato são comuns e, em geral, legais." : "") +
        (!c.hasParty && c.politicians === c.nodes.length ? " Só candidatos: doações entre colegas de campanha são comuns e, em geral, legais." : "") +
        (c.hasPublic ? " Envolve dinheiro público (cota, emenda ou verba de gabinete)." : ""),
      politician_id: pol?.key.slice(2) ?? null,
      doc: nodes.find((n) => n.doc && n.doc.length === 14)?.doc ?? null,
      amount_cents: c.minEdge,
      evidence: JSON.stringify({
        nodes: nodes.map((n) => ({ key: n.key, label: n.label, kind: n.kind, slug: n.slug ?? null, doc: n.doc ?? null })),
        steps,
        total_cents: c.total,
        min_edge_cents: c.minEdge,
        has_party: c.hasParty,
        has_public: c.hasPublic,
      }),
      created_at: createdAt,
    });
  }
  // Mesmo conjunto de nós pode fechar mais de um ciclo (sentidos diferentes): fica o de maior valor.
  const seenKeys = new Set<string>();
  const unique = rows.filter((r) => (seenKeys.has(r.key as string) ? false : (seenKeys.add(r.key as string), true)));

  await db.prepare("DELETE FROM signal WHERE rule = 'ciclo_dinheiro'").run();
  await insertJsonRows(
    db,
    "signal",
    ["key", "rule", "rule_version", "severity", "title", "detail", "politician_id", "doc", "amount_cents", "evidence", "created_at"],
    unique,
  );
  return {
    nodes: names.length,
    edges: pair.size,
    sccs: comps.length,
    largest_scc: comps.reduce((m, c) => Math.max(m, c.length), 0),
    cycles_found: found.length,
    cycles_over_threshold: scored.length,
    stored: unique.length,
    with_public_money: scored.filter((c) => c.hasPublic).length,
    with_party: scored.filter((c) => c.hasParty).length,
    hubs_skipped: state.hubs,
    intermediaries_removed: intermediaries.size,
    capped: found.length >= MAX_CYCLES,
  };
}
