import { Link } from "react-router";

import { QUOTA_SOURCE } from "~/components/federal";
import { BarList, Card, Page, SourceNote, Stat, Stats } from "~/components/ui";
import { fedCategories, fedRanking, fedYears, type House } from "~/lib/db.server";
import { brl, brlCompact, fedCategory, HOUSE_LABEL, int } from "~/lib/format";
import type { Route } from "./+types/congresso";
import { ds, src } from "~/lib/sources";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const who = data?.house === "senado" ? "senadores" : "deputados federais";
  return [{ title: `Cota parlamentar dos ${who} de SC em ${data?.year ?? ""} — Verba SC` }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const sp = new URL(request.url).searchParams;
  const house: House = sp.get("casa") === "senado" ? "senado" : "camara";
  const years = await fedYears(house);
  const asked = Number(sp.get("ano"));
  const year = years.includes(asked) ? asked : years[0];
  if (!year) return { house, years, year: null, ranking: [], categories: [] };
  const [ranking, categories] = await Promise.all([fedRanking(house, year), fedCategories(house, year)]);
  return { house, years, year, ranking, categories };
}

export default function Congresso({ loaderData }: Route.ComponentProps) {
  const { house, years, year, ranking, categories } = loaderData;
  const tab = (h: House, label: string) => (
    <Link
      to={`?casa=${h}`}
      className={`rounded-md border px-3 py-1.5 text-sm ${house === h ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`}
    >
      {label}
    </Link>
  );
  const total = ranking.reduce((s, r) => s + r.cents, 0);
  const top = ranking[0]?.cents ?? 1;
  return (
    <Page
      kicker="Congresso Nacional · bancada de Santa Catarina"
      title={house === "camara" ? "Deputados federais de SC" : "Senadores de SC"}
      intro={
        <p>
          Gastos pagos com a cota para o exercício da atividade parlamentar: passagens, combustível, escritório de apoio,
          divulgação do mandato, locação de veículos, hospedagem e alimentação. Não inclui salários nem verba de gabinete
          (assessores). Cada categoria é comparada com a mediana de <strong>todos os parlamentares do país</strong>.
        </p>
      }
    >
      <div className="flex flex-wrap gap-2">
        {tab("camara", "Câmara dos Deputados")}
        {tab("senado", "Senado Federal")}
      </div>
      {!year ? (
        <p className="text-ink-3">Ainda não há dados coletados.</p>
      ) : (
        <>
          <nav className="scroll-strip -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" aria-label="Ano">
            {years.map((y) => (
              <Link
                key={y}
                to={`?casa=${house}&ano=${y}`}
                preventScrollReset
                className={`num shrink-0 rounded-md border px-2.5 py-1 text-sm ${y === year ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"}`}
              >
                {y}
              </Link>
            ))}
          </nav>
          <Stats>
            <Stat label={`Total da bancada em ${year}`} value={brlCompact(total)} note={`${int(ranking.length)} parlamentares com gastos`} src={src.fed(house, year)} />
            <Stat label="Média por parlamentar" value={brlCompact(ranking.length ? total / ranking.length : 0)} />
            <Stat label="Maior gasto" value={brlCompact(ranking[0]?.cents)} note={ranking[0]?.name} />
            <Stat label="Lançamentos" value={int(ranking.reduce((s, r) => s + r.n, 0))} />
          </Stats>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title={`Ranking · ${year}`} subtitle="Clique no nome para ver fornecedores, notas fiscais e a campanha" src={src.fed(house, year)}>
                <div className="table-wrap -mx-4 sm:-mx-5">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Parlamentar</th>
                        <th className="r">Total</th>
                        <th className="hidden sm:table-cell">Principais categorias (× mediana nacional)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r, i) => (
                        <tr key={r.member_id}>
                          <td className="num text-ink-3">{i + 1}</td>
                          <td className="min-w-40">
                            {r.slug ? (
                              <Link to={`/pessoa/${r.slug}`} className="link">
                                {r.name}
                              </Link>
                            ) : (
                              r.name
                            )}
                            {r.party && <span className="ml-1.5 text-xs text-ink-3">{r.party}</span>}
                            {r.role && r.role !== "Titular" && <span className="ml-1.5 text-xs text-ink-3">({r.role})</span>}
                            <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--bar-track)" }}>
                              <div className="h-1.5 rounded-full" style={{ width: `${(r.cents / top) * 100}%`, background: "var(--bar)" }} />
                            </div>
                          </td>
                          <td className="r" title={brl(r.cents)}>
                            {brlCompact(r.cents)}
                          </td>
                          <td className="hidden text-xs text-ink-2 sm:table-cell">
                            {r.categories
                              .slice(0, 3)
                              .map((c) => {
                                const x = c.median_cents ? ` (${(c.cents / c.median_cents).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×)` : "";
                                return `${fedCategory(c.category)} ${brlCompact(c.cents)}${x}`;
                              })
                              .join(" · ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <Card title="Por categoria" subtitle={`Soma da bancada de SC em ${year}`} src={src.fed(house, year)}>
              <BarList
                items={categories.map((c) => ({
                  key: c.category,
                  label: fedCategory(c.category),
                  cents: c.cents,
                  note: `${c.members} parlamentar(es) · mediana nacional ${brlCompact(c.median_cents)}`,
                }))}
              />
            </Card>
          </div>
        </>
      )}
      <SourceNote>
        <a className="link" href={QUOTA_SOURCE[house].href} rel="noreferrer">
          {QUOTA_SOURCE[house].label}
        </a>
        . {HOUSE_LABEL[house]}: arquivos nacionais; o site guarda os lançamentos de SC e, do país, só a estatística por
        categoria.
      </SourceNote>
    </Page>
  );
}
