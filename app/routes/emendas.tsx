import { Link } from "react-router";

import { AuthorLink, EMENDAS_SOURCE, EmendasNote } from "~/components/emendas";
import { BarList, Card, Page, SourceNote, Stat, Stats } from "~/components/ui";
import { emendaOverview, emendaYears } from "~/lib/db.server";
import { brl, brlCompact, int, titleCase } from "~/lib/format";
import type { Route } from "./+types/emendas";

export function meta() {
  return [{ title: "Emendas parlamentares dos deputados federais e senadores de SC — Verba SC" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const years = await emendaYears();
  const asked = Number(new URL(request.url).searchParams.get("ano"));
  const year = years.includes(asked) ? asked : null;
  return { years, year, ...(await emendaOverview(year)) };
}

export default function Emendas({ loaderData }: Route.ComponentProps) {
  const { years, year, authors, municipios, funcoes, totals } = loaderData;
  const chip = (active: boolean) =>
    `num rounded-md border px-2.5 py-1 text-sm ${active ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`;
  const top = authors[0]?.executed || 1;
  return (
    <Page
      kicker="Orçamento da União"
      title="Emendas parlamentares da bancada de SC"
      intro={
        <p>
          Recursos do orçamento federal que cada deputado federal e senador de Santa Catarina indicou para municípios,
          hospitais, entidades e obras, além das emendas coletivas da bancada catarinense. Mostra para onde o dinheiro foi e
          quem recebeu, com CNPJ.
        </p>
      }
    >
      <nav className="flex flex-wrap gap-1.5" aria-label="Ano">
        <Link to="?" preventScrollReset className={chip(year === null)}>
          Todos os anos
        </Link>
        {years.map((y) => (
          <Link key={y} to={`?ano=${y}`} preventScrollReset className={chip(y === year)}>
            {y}
          </Link>
        ))}
      </nav>
      <Stats>
        <Stat label="Emendas" value={int(totals?.n)} note={year ? `de ${year}` : "todos os anos"} />
        <Stat label="Empenhado" value={brlCompact(totals?.committed)} />
        <Stat label="Executado" value={brlCompact(totals?.executed)} note="pago + restos a pagar pagos" />
        <Stat label="Autores" value={int(authors.length)} note="parlamentares e bancada" />
      </Stats>
      <EmendasNote />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title="Por autor" subtitle="Clique no nome para ver destinos, favorecidos e convênios">
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Autor</th>
                    <th className="r">Emendas</th>
                    <th className="r">Empenhado</th>
                    <th className="r">Executado</th>
                  </tr>
                </thead>
                <tbody>
                  {authors.map((a) => (
                    <tr key={a.author_name}>
                      <td className="min-w-44">
                        <AuthorLink name={a.author_name} slug={a.slug} />
                        {a.party && <span className="ml-1.5 text-xs text-ink-3">{a.party}</span>}
                        <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--bar-track)" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${(a.executed / top) * 100}%`, background: "var(--bar)" }} />
                        </div>
                      </td>
                      <td className="r">{int(a.n)}</td>
                      <td className="r">{brlCompact(a.committed)}</td>
                      <td className="r font-medium" title={brl(a.executed)}>
                        {brlCompact(a.executed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Por área" subtitle="Função orçamentária">
          <BarList items={funcoes.map((f) => ({ key: f.funcao, label: f.funcao, cents: f.executed, note: `${int(f.n)} emenda(s)` }))} />
        </Card>
      </div>

      <Card title="Destinos que mais receberam" subtitle="Localidade de aplicação informada na emenda">
        <BarList
          items={municipios.map((m) => ({
            key: `${m.municipio}-${m.uf}`,
            label: titleCase(m.municipio),
            cents: m.executed,
            note: `${int(m.n)} emenda(s) de ${int(m.authors)} autor(es)${m.uf ? ` · ${titleCase(m.uf)}` : ""}`,
          }))}
        />
      </Card>
      <SourceNote>
        <a className="link" href={EMENDAS_SOURCE} rel="noreferrer">
          Portal da Transparência (CGU), emendas parlamentares
        </a>
        . Autores identificados pelo nome parlamentar dos deputados federais e senadores de SC; a bancada aparece como
        “Bancada de Santa Catarina”.
      </SourceNote>
    </Page>
  );
}
