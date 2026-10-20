import { Link } from "react-router";

import { SignalList } from "~/components/signals";
import { Card, Disclaimer, Page, Stat, Stats } from "~/components/ui";
import { overview, topSignals } from "~/lib/db.server";
import { brlCompact, dateBr, int } from "~/lib/format";
import type { Route } from "./+types/home";
import { ds, src } from "~/lib/sources";

export function meta() {
  return [
    { title: "Verba SC — como deputados estaduais, vereadores e a Prefeitura de Florianópolis usam o dinheiro público" },
    {
      name: "description",
      content:
        "Gastos de gabinete da ALESC, despesas da Prefeitura e da Câmara de Florianópolis e contas de campanha do TSE, cruzados e com a fonte de cada número.",
    },
  ];
}

export async function loader() {
  const [o, signals] = await Promise.all([overview(), topSignals(5)]);
  return { o, signals };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { o, signals } = loaderData;
  const count = (sev: string) => o.signals.find((s) => s.severity === sev)?.n ?? 0;
  return (
    <Page
      kicker="Santa Catarina · Florianópolis"
      title="Para onde vai a verba de quem você elegeu"
      intro={
        <p>
          Gastos do <strong>Governo do Estado</strong>, cota parlamentar dos <strong>deputados federais e senadores</strong> de SC, gastos de gabinete dos{" "}
          <strong>deputados estaduais</strong> (ALESC), despesas da <strong>Prefeitura</strong> e da{" "}
          <strong>Câmara de Vereadores</strong> de Florianópolis e as <strong>contas de campanha</strong> declaradas ao TSE,
          num só lugar e cruzados por CNPJ. Cada número leva ao arquivo oficial de onde saiu.
        </p>
      }
    >
      <Stats>
        <Stat
          label={`ALESC · gabinetes ${o.alesc?.year ?? ""}`}
          value={brlCompact(o.alesc?.cents)}
          note={`${int(o.alesc?.accounts)} gabinetes`}
          src={o.alesc ? src.alesc(o.alesc.year) : null}
        />
        <Stat
          label={`Congresso · cota ${o.fed?.year ?? ""}`}
          value={brlCompact(o.fed?.cents)}
          note={`${int(o.fed?.members)} deputados federais e senadores de SC`}
          src={o.fed ? [src.camara(o.fed.year), src.senado(o.fed.year)] : null}
        />
        <Stat
          label={`Câmara · assessores (${o.staff?.ref_month ?? "–"})`}
          value={brlCompact(o.staff?.cents)}
          note={`${int(o.staff?.people)} comissionados em gabinetes, no mês`}
          src={src.cmfStaff()}
        />
        <Stat label={`Prefeitura · pago em ${o.pmf?.year ?? ""}`} value={brlCompact(o.pmf?.cents)} note={`${int(o.pmf?.payees)} favorecidos`} src={o.pmf ? src.pmf(o.pmf.year) : null} />
      </Stats>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { to: "/ciclos", t: "Ciclos de dinheiro", d: "Dinheiro que sai de alguém e, passando por outros, volta para a mesma pessoa." },
          { to: "/governo", t: "Governo do Estado", d: "Gastos do Executivo por órgão, o Gabinete do Governador, a publicidade oficial e os contratos." },
          { to: "/congresso", t: "Congresso", d: "Cota parlamentar dos deputados federais e senadores de SC, com notas fiscais e comparação com o país." },
          { to: "/emendas", t: "Emendas parlamentares", d: "Para onde a bancada de SC mandou recursos da União, e quem recebeu o dinheiro." },
          { to: "/deputados", t: "Deputados estaduais (ALESC)", d: "Diárias, passagens, aluguel, gráfica e reembolsos de cada gabinete, comparados com os colegas." },
          { to: "/vereadores", t: "Vereadores de Florianópolis", d: "Quantos assessores cada gabinete tem, quanto custam por mês e quem a Câmara paga." },
          { to: "/prefeitura", t: "Prefeitura de Florianópolis", d: "Os maiores favorecidos, contratos no PNCP e as diárias do prefeito e do vice." },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="group rounded-xl border border-line bg-surface p-5 hover:border-accent">
            <h2 className="font-semibold group-hover:text-accent-ink">{c.t} →</h2>
            <p className="mt-1 text-sm text-ink-2">{c.d}</p>
          </Link>
        ))}
      </div>

      <Card
        title="Sinais mais relevantes"
        subtitle={`${int(count("high") + count("medium") + count("low"))} coincidências para verificar, ${int(count("high"))} de severidade alta`}
        action={
          <Link to="/sinais" className="link text-sm">
            Ver todos
          </Link>
        }
      >
        <SignalList rows={signals} />
      </Card>

      <Disclaimer />
      {o.updated && <p className="text-xs text-ink-3">Última coleta: {dateBr(o.updated)}.</p>}
    </Page>
  );
}
