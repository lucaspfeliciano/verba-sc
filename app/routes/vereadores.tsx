import { Link } from "react-router";

import { BarList, Card, Page, SourceNote, Stat, Stats, YearTabs } from "~/components/ui";
import { cmfOffices, electedCouncil, payeeTotals, payeeYears, topPayees } from "~/lib/db.server";
import { brl, brlCompact, docLabel, int, isCnpj, officeLabel, titleCase } from "~/lib/format";
import type { Route } from "./+types/vereadores";

export function meta() {
  return [{ title: "Vereadores de Florianópolis: assessores, gastos da Câmara e campanhas — Verba SC" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const years = await payeeYears(1018);
  const asked = Number(new URL(request.url).searchParams.get("ano"));
  const year = years.includes(asked) ? asked : years[0];
  const [offices, council, payees, totals] = await Promise.all([
    cmfOffices(),
    electedCouncil(),
    year ? topPayees(1018, year, 20) : [],
    year ? payeeTotals(1018, year) : null,
  ]);
  return { offices, council, payees, totals, years, year };
}

export default function Vereadores({ loaderData }: Route.ComponentProps) {
  const { offices, council, payees, totals, years, year } = loaderData;
  const totalStaff = offices.offices.reduce((s, o) => s + o.cents, 0);
  const people = offices.offices.reduce((s, o) => s + o.people, 0);
  const top = offices.offices[0]?.cents ?? 1;
  return (
    <Page
      kicker="Câmara Municipal de Florianópolis"
      title="Vereadores de Florianópolis"
      intro={
        <p>
          O maior custo de um gabinete de vereador são os assessores comissionados, nomeados livremente. Aqui está quanto cada
          gabinete custou em vencimentos brutos no último mês publicado, quem a Câmara paga e quanto cada vereador eleito
          arrecadou e gastou na campanha.
        </p>
      }
    >
      <Stats>
        <Stat label={`Assessores de gabinete · ${offices.month ?? "–"}`} value={brlCompact(totalStaff)} note={`${int(people)} pessoas no mês`} />
        <Stat label="Média por gabinete" value={brlCompact(offices.offices.length ? totalStaff / offices.offices.length : 0)} note={`${int(offices.offices.length)} gabinetes`} />
        <Stat label="Projeção anual (×13)" value={brlCompact(totalStaff * 13)} note="12 salários + 13º, sem encargos" />
        <Stat label={`Câmara pagou em ${year ?? ""}`} value={brlCompact(totals?.paid)} note={`${int(totals?.payees)} favorecidos`} />
      </Stats>

      <Card title={`Custo dos gabinetes · ${offices.month ?? ""}`} subtitle="Soma dos vencimentos brutos dos comissionados lotados em cada gabinete">
        {offices.offices.length === 0 ? (
          <p className="text-sm text-ink-3">Ainda não há dados de pessoal coletados.</p>
        ) : (
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Gabinete</th>
                  <th className="r">Assessores</th>
                  <th className="r">Bruto no mês</th>
                </tr>
              </thead>
              <tbody>
                {offices.offices.map((o) => (
                  <tr key={o.office}>
                    <td className="min-w-48">
                      {o.slug ? (
                        <Link to={`/pessoa/${o.slug}`} className="link">
                          {officeLabel(o.office)}
                        </Link>
                      ) : (
                        o.office
                      )}
                      {o.party && <span className="ml-1.5 text-xs text-ink-3">{o.party}</span>}
                      <div className="mt-1 h-1.5 rounded-full" style={{ background: "var(--bar-track)" }}>
                        <div className="h-1.5 rounded-full" style={{ width: `${(o.cents / top) * 100}%`, background: "var(--bar)" }} />
                      </div>
                    </td>
                    <td className="r">{o.people}</td>
                    <td className="r">{brl(o.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <SourceNote>
          Câmara Municipal de Florianópolis, portal e-Publica, cargos comissionados (lotação e vencimentos). O Gabinete da
          Presidência é estrutura administrativa da Mesa e fica fora desta conta.
        </SourceNote>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Vereadores eleitos · campanha" subtitle="Receitas e despesas declaradas ao TSE na última eleição municipal">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Vereador(a)</th>
                  <th className="r">Arrecadou</th>
                  <th className="r">Gastou</th>
                </tr>
              </thead>
              <tbody>
                {council.map((c) => (
                  <tr key={c.slug}>
                    <td>
                      <Link to={`/pessoa/${c.slug}`} className="link">
                        {c.ballot_name}
                      </Link>{" "}
                      <span className="text-xs text-ink-3">{c.party}</span>
                    </td>
                    <td className="r">{brlCompact(c.receipts)}</td>
                    <td className="r">{brlCompact(c.expenses)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Quem a Câmara pagou · ${year ?? ""}`} subtitle="Maiores favorecidos, por empenhos emitidos no ano" action={years.length > 1 && year ? <YearTabs years={years} current={year} /> : undefined}>
          <BarList
            items={payees.map((p) => ({
              key: p.doc,
              label: titleCase(p.name),
              href: isCnpj(p.doc) ? `/fornecedor/${p.doc}` : undefined,
              cents: p.paid_cents,
              note: docLabel(p.doc),
            }))}
          />
        </Card>
      </div>
    </Page>
  );
}
