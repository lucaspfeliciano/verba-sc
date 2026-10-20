import { Link } from "react-router";

import { BarList, Card, Page, SourceNote, Stat, Stats, YearTabs } from "~/components/ui";
import { RecipientsByCategory } from "~/components/recipients";
import { CATEGORY_NATUREZAS } from "~/lib/alesc-map";
import { alescCategories, alescRanking, alescRecipients, alescYears } from "~/lib/db.server";
import { brl, brlCompact, gabineteHref, int, titleCase } from "~/lib/format";
import type { Route } from "./+types/deputados";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Gastos de gabinete dos deputados estaduais de SC em ${data?.year ?? ""} — Verba SC` }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const years = await alescYears();
  const asked = Number(new URL(request.url).searchParams.get("ano"));
  const year = years.includes(asked) ? asked : years[0];
  if (!year) return { years, year: null, ranking: [], categories: [], recipients: { scoped: false, rows: [] } };
  const naturezas = [...new Set(Object.values(CATEGORY_NATUREZAS).flat())];
  const [ranking, categories, recipients] = await Promise.all([
    alescRanking(year),
    alescCategories(year),
    alescRecipients(year, naturezas),
  ]);
  return { years, year, ranking, categories, recipients };
}

export default function Deputados({ loaderData }: Route.ComponentProps) {
  const { years, year, ranking, categories, recipients } = loaderData;
  if (!year) return <Page title="Deputados estaduais">Ainda não há dados da ALESC coletados.</Page>;
  const total = ranking.reduce((s, r) => s + r.cents, 0);
  const deputies = ranking.filter((r) => r.slug);
  const median = deputies.length ? [...deputies].sort((a, b) => a.cents - b.cents)[Math.floor(deputies.length / 2)].cents : 0;
  const top = ranking[0]?.cents ?? 1;
  return (
    <Page
      kicker="Assembleia Legislativa de Santa Catarina"
      title="Gastos dos gabinetes dos deputados estaduais"
      intro={
        <p>
          Despesas pagas pela ALESC com a cota de cada gabinete: diárias, passagens, telefone, veículos, aluguel de escritório,
          gráfica e reembolsos. Não inclui salários do deputado nem de assessores.
        </p>
      }
    >
      <YearTabs years={years} current={year} />
      <Stats>
        <Stat label={`Total em ${year}`} value={brlCompact(total)} note={`${int(ranking.length)} contas`} />
        <Stat label="Mediana por deputado" value={brlCompact(median)} note={`${int(deputies.length)} identificados`} />
        <Stat label="Maior gasto" value={brlCompact(ranking[0]?.cents)} note={ranking[0]?.account} />
        <Stat label="Lançamentos" value={int(ranking.reduce((s, r) => s + r.n, 0))} />
      </Stats>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card title={`Ranking por gabinete · ${year}`} subtitle="Clique no nome para ver o detalhe, os maiores favorecidos e a campanha">
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Gabinete</th>
                    <th className="r">Total</th>
                    <th className="hidden sm:table-cell">Principais verbas</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => (
                    <tr key={r.account}>
                      <td className="num text-ink-3">{i + 1}</td>
                      <td className="min-w-40">
                        <Link to={gabineteHref(r.account, r.slug)} className="link">
                          {r.account}
                        </Link>
                        {r.party && <span className="ml-1.5 text-xs text-ink-3">{r.party}</span>}
                        <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--bar-track)" }}>
                          <div className="h-1.5 rounded-full" style={{ width: `${(r.cents / top) * 100}%`, background: "var(--bar)" }} />
                        </div>
                      </td>
                      <td className="r" title={brl(r.cents)}>
                        {brlCompact(r.cents)}
                        {median > 0 && r.slug && (
                          <div className="text-xs text-ink-3">{(r.cents / median).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}× mediana</div>
                        )}
                      </td>
                      <td className="hidden text-xs text-ink-2 sm:table-cell">
                        {r.categories
                          .slice(0, 3)
                          .map((c) => `${titleCase(c.category)} ${brlCompact(c.cents)}`)
                          .join(" · ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <Card title="Por tipo de verba" subtitle={`Soma de todos os gabinetes em ${year}`}>
          <BarList
            items={categories.map((c) => ({
              key: c.category,
              label: titleCase(c.category),
              cents: c.cents,
              note: `${c.accounts} gabinetes`,
            }))}
          />
        </Card>
      </div>
      <Card
        title={`Quem recebe o dinheiro de cada verba · ${year}`}
        subtitle="O CSV dos gabinetes diz em que o dinheiro foi gasto; os pagamentos a credores da ALESC dizem quem recebeu, com CPF/CNPJ"
      >
        <RecipientsByCategory year={year} categories={categories} recipients={recipients} />
      </Card>
      <SourceNote>
        ALESC, Portal da Transparência,{" "}
        <a className="link" href="https://transparencia.alesc.sc.gov.br/gabinetes-parlamentares/dados-abertos" rel="noreferrer">
          despesas dos gabinetes parlamentares
        </a>{" "}
        e{" "}
        <a className="link" href="https://transparencia.alesc.sc.gov.br/pagamentos/dados-abertos" rel="noreferrer">
          pagamentos a credores
        </a>{" "}
        (CSVs anuais). Contas sem link para pessoa não foram associadas com segurança a um candidato do TSE.
      </SourceNote>
    </Page>
  );
}
