import { Link } from "react-router";

import { RULE_HELP, RULE_LABEL, SignalList } from "~/components/signals";
import { Card, Disclaimer, Page } from "~/components/ui";
import { signals } from "~/lib/db.server";
import { int } from "~/lib/format";
import type { Route } from "./+types/sinais";

export function meta() {
  return [{ title: "Sinais para verificação — Verba SC" }];
}

const SEVERITIES = [
  { v: "high", l: "Alta" },
  { v: "medium", l: "Média" },
  { v: "low", l: "Baixa" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const rule = sp.get("regra") && RULE_LABEL[sp.get("regra")!] ? sp.get("regra")! : undefined;
  const severity = SEVERITIES.some((s) => s.v === sp.get("severidade")) ? sp.get("severidade")! : undefined;
  const page = Math.max(1, Number(sp.get("pagina")) || 1);
  return { ...(await signals({ rule, severity, page })), rule, severity, page };
}

function qs(p: Record<string, string | number | undefined>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "?";
}

export default function Sinais({ loaderData }: Route.ComponentProps) {
  const { total, rows, counts, rule, severity, page } = loaderData;
  const n = (r?: string, s?: string) => counts.filter((c) => (!r || c.rule === r) && (!s || c.severity === s)).reduce((a, c) => a + c.n, 0);
  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-sm ${active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`;
  return (
    <Page
      kicker="Dados derivados"
      title="Sinais para verificação"
      intro={
        <p>
          Regras automáticas que apontam coincidências nos dados públicos. Um sinal não é prova de irregularidade: é um ponto
          de partida para checar documentos, contratos e notas.
        </p>
      }
    >
      <Disclaimer />
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <Link to={qs({ severidade: severity })} className={chip(!rule)}>
            Todas as regras ({int(n(undefined, severity))})
          </Link>
          {Object.keys(RULE_LABEL).map((r) => (
            <Link key={r} to={qs({ regra: r, severidade: severity })} className={chip(rule === r)}>
              {RULE_LABEL[r]} ({int(n(r, severity))})
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link to={qs({ regra: rule })} className={chip(!severity)}>
            Toda severidade
          </Link>
          {SEVERITIES.map((s) => (
            <Link key={s.v} to={qs({ regra: rule, severidade: s.v })} className={chip(severity === s.v)}>
              {s.l} ({int(n(rule, s.v))})
            </Link>
          ))}
        </div>
        {rule && <p className="text-sm text-ink-2">{RULE_HELP[rule]}</p>}
      </div>
      <Card title={`${int(total)} sinal(is)`}>
        <SignalList rows={rows} />
        {total > 50 && (
          <div className="mt-4 flex gap-3 text-sm">
            {page > 1 && (
              <Link className="link" to={qs({ regra: rule, severidade: severity, pagina: page - 1 })}>
                ← Anteriores
              </Link>
            )}
            {page * 50 < total && (
              <Link className="link" to={qs({ regra: rule, severidade: severity, pagina: page + 1 })}>
                Próximos →
              </Link>
            )}
          </div>
        )}
      </Card>
      <Card title="Como cada regra funciona">
        <dl className="space-y-3 text-sm">
          {Object.entries(RULE_HELP).map(([k, v]) => (
            <div key={k}>
              <dt className="font-medium">{RULE_LABEL[k]}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </Page>
  );
}
