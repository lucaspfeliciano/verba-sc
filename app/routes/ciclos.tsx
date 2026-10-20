import { Link } from "react-router";

import { CycleGraph, KindLegend, type CycleNode, type CycleStep } from "~/components/cycle-graph";
import { Card, Disclaimer, Page, SeverityBadge, Stat, Stats } from "~/components/ui";
import { cycles, cycleStats } from "~/lib/db.server";
import { brlCompact, dateBr, int } from "~/lib/format";
import { ds } from "~/lib/sources";
import type { Route } from "./+types/ciclos";

export function meta() {
  return [
    { title: "Ciclos de dinheiro entre políticos, doadores e fornecedores de SC — Verba SC" },
    {
      name: "description",
      content: "Quando o dinheiro sai de alguém e, passando por outros, volta para a mesma pessoa. Detectado com o algoritmo de Tarjan sobre doações, pagamentos de campanha, cota parlamentar, emendas e verba de gabinete.",
    },
  ];
}

const SEVERITIES = [
  { v: "high", l: "Alta" },
  { v: "medium", l: "Média" },
  { v: "low", l: "Baixa" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const severity = SEVERITIES.some((s) => s.v === sp.get("severidade")) ? sp.get("severidade")! : undefined;
  const publico = sp.get("publico") === "1";
  const todos = sp.get("todos") === "1";
  const page = Math.max(1, Number(sp.get("pagina")) || 1);
  const [list, stats] = await Promise.all([cycles({ severity, publico, todos, page }), cycleStats()]);
  return { ...list, stats, severity, publico, todos, page };
}

function qs(p: Record<string, string | number | boolean | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== false && v !== "") s.set(k, v === true ? "1" : String(v));
  const out = s.toString();
  return out ? `?${out}` : "?";
}

export default function Ciclos({ loaderData }: Route.ComponentProps) {
  const { total, rows, counts, stats, severity, publico, todos, page } = loaderData;
  const n = (sev?: string) => counts.filter((c) => !sev || c.severity === sev).reduce((a, c) => a + c.n, 0);
  const chip = (active: boolean) =>
    `shrink-0 rounded-md border px-2.5 py-1 text-sm ${active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`;
  const base = { severidade: severity, publico, todos };
  return (
    <Page
      kicker="Rede de dinheiro"
      title="Ciclos de dinheiro"
      intro={
        <div className="space-y-3">
          <p>
            Um ciclo acontece quando o dinheiro sai de alguém e, passando por outras pessoas ou empresas, volta para quem
            começou: a campanha paga um fornecedor, o fornecedor (ou alguém ligado a ele) doa para outro candidato, que doa
            de volta. Montamos um grafo com todas as ligações de dinheiro conhecidas e procuramos esses caminhos de volta.
          </p>
          <p>
            <strong>Ciclo não é crime.</strong> Partidos financiam candidatos e recebem as sobras; colegas de chapa doam
            entre si. Mas ciclos curtos com pessoas e empresas de fora, ou com dinheiro público no meio, merecem ser
            conhecidos.
          </p>
        </div>
      }
    >
      {stats && (
        <Stats>
          <Stat label="Participantes no grafo" value={int(Number(stats.nodes))} note={`${int(Number(stats.edges))} ligações de dinheiro`} src={[ds("tse", "receitas"), ds("tse", "despesas_contratadas")]} />
          <Stat label="Grupos com ciclo possível" value={int(Number(stats.sccs))} note={`componentes fortemente conexos (Tarjan); o maior tem ${int(Number(stats.largest_scc))}`} />
          <Stat label="Ciclos encontrados" value={int(Number(stats.cycles_found))} note={`${int(Number(stats.cycles_over_threshold))} acima de R$ 10 mil`} />
          <Stat label="Com dinheiro público" value={int(Number(stats.with_public_money))} note="cota, emenda ou verba de gabinete" />
        </Stats>
      )}

      <Card title="Como os ciclos são encontrados">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>
            <strong className="text-ink">Grafo de quem paga quem.</strong> Cada pessoa, empresa, partido ou político é um
            participante (identificado por CPF/CNPJ; o político junta o CPF e os CNPJs das campanhas). Cada ligação é dinheiro
            que saiu de um e entrou em outro: doações e pagamentos de campanha (TSE), cota parlamentar (Câmara e Senado),
            emendas (CGU) e verba de gabinete da ALESC.
          </li>
          <li>
            <strong className="text-ink">Tarjan.</strong> O algoritmo de Tarjan separa o grafo em componentes fortemente
            conexos: grupos em que todo participante consegue chegar a todos os outros seguindo o dinheiro. Só dentro deles
            pode haver ciclo, o que elimina a maior parte do grafo de uma vez.
          </li>
          <li>
            <strong className="text-ink">Até 5 participantes.</strong> Dentro de cada grupo, uma busca em profundidade lista os
            ciclos com no máximo 5 participantes. Caminhos mais longos são difíceis de interpretar.
          </li>
          <li>
            <strong className="text-ink">Acima de R$ 10 mil.</strong> Entram os ciclos que movimentaram ao menos R$ 10 mil no
            total. A severidade usa o menor valor do ciclo, que é o máximo que pode ter dado a volta completa.
          </li>
          <li>
            <strong className="text-ink">Sem intermediários.</strong> Desde 2015 empresas não podem doar a campanhas: “doações”
            de CNPJ são repasses de plataformas de financiamento coletivo, que também cobram taxa das campanhas. Elas criariam
            ciclos falsos e ficam fora.
          </li>
        </ol>
        <p className="mt-3 text-sm text-ink-2">
          Severidade: <strong>alta</strong> para ciclos de até 3 participantes ou com dinheiro público em que ao menos R$ 5 mil
          podem ter dado a volta; <strong>baixa</strong> para ciclos com partido, só entre candidatos ou em que a menor ligação
          é inferior a R$ 1 mil; <strong>média</strong> nos demais.
        </p>
        {stats?.finished_at && <p className="mt-2 text-xs text-ink-3">Calculado em {dateBr(String(stats.finished_at))}.</p>}
      </Card>

      <div className="space-y-3">
        <div className="scroll-strip -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Link to={qs({ publico, todos })} className={chip(!severity)}>
            {todos ? "Todas" : "Alta e média"} ({int(todos ? n() : n("high") + n("medium"))})
          </Link>
          {SEVERITIES.map((s) => (
            <Link key={s.v} to={qs({ severidade: s.v, publico })} className={chip(severity === s.v)}>
              {s.l} ({int(n(s.v))})
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to={qs({ ...base, publico: !publico, pagina: undefined })} className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
            <span className={`grid h-4 w-4 place-items-center rounded border ${publico ? "border-accent bg-accent text-white" : "border-line"}`}>
              {publico ? "✓" : ""}
            </span>
            Só com dinheiro público
          </Link>
          {!severity && (
            <Link to={qs({ ...base, todos: !todos, pagina: undefined })} className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
              <span className={`grid h-4 w-4 place-items-center rounded border ${todos ? "border-accent bg-accent text-white" : "border-line"}`}>
                {todos ? "✓" : ""}
              </span>
              Incluir ciclos com partido e entre candidatos
            </Link>
          )}
        </div>
        <KindLegend />
      </div>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-3">Nenhum ciclo com esses filtros.</p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => {
            const ev = JSON.parse(r.evidence) as { nodes: CycleNode[]; steps: CycleStep[]; total_cents: number; min_edge_cents: number; has_public: boolean };
            return (
              <Link key={r.key} to={`/sinais/${r.key}`} className="group flex flex-col rounded-xl border border-line bg-surface p-3 hover:border-accent">
                <div className="flex items-center justify-between gap-2">
                  <SeverityBadge severity={r.severity} />
                  <span className="text-xs text-ink-3">
                    {ev.nodes.length} participantes{ev.has_public ? " · dinheiro público" : ""}
                  </span>
                </div>
                <CycleGraph nodes={ev.nodes} steps={ev.steps} size="sm" />
                <p className="mt-1 text-sm">
                  Até <strong className="num">{brlCompact(ev.min_edge_cents)}</strong> podem ter dado a volta
                  <span className="text-ink-3"> · {brlCompact(ev.total_cents)} movimentados</span>
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-3" title={ev.nodes.map((x) => x.label).join(" → ")}>
                  {ev.nodes.map((x) => x.label).join(" → ")} → {ev.nodes[0].label}
                </p>
                <span className="mt-2 text-sm font-medium text-accent-ink group-hover:underline">Ver o ciclo →</span>
              </Link>
            );
          })}
        </div>
      )}

      {total > 24 && (
        <div className="flex items-center gap-4 text-sm">
          {page > 1 && (
            <Link className="link" to={qs({ ...base, pagina: page - 1 })}>
              ← Anteriores
            </Link>
          )}
          <span className="text-ink-3">
            {int((page - 1) * 24 + 1)}–{int(Math.min(page * 24, total))} de {int(total)}
          </span>
          {page * 24 < total && (
            <Link className="link" to={qs({ ...base, pagina: page + 1 })}>
              Próximos →
            </Link>
          )}
        </div>
      )}
      <Disclaimer />
      <p className="text-xs text-ink-3">
        Inspirado na regra de doação circular do EloSys (Tarjan, até 5 participantes, R$ 10 mil). Valores somam todas as
        eleições e anos disponíveis: uma ligação pode ter ocorrido anos antes da outra.
      </p>
    </Page>
  );
}
