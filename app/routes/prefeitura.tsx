import { Link } from "react-router";

import { BarList, Card, Page, SourceNote, Stat, Stats, YearTabs } from "~/components/ui";
import { mayors, payeeTotals, payeeYears, pncpTop, perDiemTop, topPayees } from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, int, isCnpj, OFFICE_LABEL, titleCase } from "~/lib/format";
import type { Route } from "./+types/prefeitura";
import { ds, src } from "~/lib/sources";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Prefeitura de Florianópolis: quem recebeu em ${data?.year ?? ""} — Verba SC` }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const years = await payeeYears(2002);
  const asked = Number(new URL(request.url).searchParams.get("ano"));
  const year = years.includes(asked) ? asked : years[0];
  if (!year) return { years, year: null, payees: [], totals: null, perDiems: [], contracts: [], mayors: await mayors() };
  const [payees, totals, perDiems, contracts, m] = await Promise.all([
    topPayees(2002, year, 30),
    payeeTotals(2002, year),
    perDiemTop(year),
    pncpTop(year),
    mayors(),
  ]);
  return { years, year, payees, totals, perDiems, contracts, mayors: m };
}

export default function Prefeitura({ loaderData }: Route.ComponentProps) {
  const { years, year, payees, totals, perDiems, contracts, mayors } = loaderData;
  const current = mayors.filter((m) => m.year === mayors[0]?.year);
  return (
    <Page
      kicker="Poder Executivo municipal"
      title="Prefeitura de Florianópolis"
      intro={
        <p>
          Pagamentos da Prefeitura e de seus fundos, fundações e autarquias, agrupados por favorecido (empresas, entidades e
          pessoas), mais os contratos publicados no PNCP e as diárias pagas a agentes públicos.
        </p>
      }
    >
      {current.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {current.map((m) => (
            <Link key={m.slug} to={`/pessoa/${m.slug}`} className="rounded-xl border border-line bg-surface px-4 py-3 hover:border-accent">
              <p className="text-xs uppercase tracking-wide text-ink-3">
                {OFFICE_LABEL[m.office]} · eleito(a) em {m.year}
              </p>
              <p className="font-semibold">
                {m.ballot_name} <span className="text-sm font-normal text-ink-3">{m.party}</span>
              </p>
            </Link>
          ))}
        </div>
      )}
      {!year ? (
        <p className="text-ink-3">Ainda não há dados da Prefeitura coletados.</p>
      ) : (
        <>
          <YearTabs years={years} current={year} />
          <Stats>
            <Stat label={`Pago em ${year}`} value={brlCompact(totals?.paid)} note="empenhos emitidos no ano" src={src.pmf(year)} />
            <Stat label="Empenhado (líquido)" value={brlCompact(totals?.committed)} />
            <Stat label="Favorecidos" value={int(totals?.payees)} />
            <Stat label="Maior favorecido" value={brlCompact(payees[0]?.paid_cents)} note={titleCase(payees[0]?.name)} />
          </Stats>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Card title={`Maiores favorecidos · ${year}`} subtitle="Valor pago dos empenhos emitidos no ano" src={src.pmf(year)}>
                <BarList
                  items={payees.map((p) => ({
                    key: p.doc,
                    label: titleCase(p.name),
                    href: isCnpj(p.doc) ? `/fornecedor/${p.doc}` : undefined,
                    cents: p.paid_cents,
                    note: `${docLabel(p.doc)} · empenhado ${brlCompact(p.committed_cents)}`,
                  }))}
                />
              </Card>
            </div>
            <Card title={`Diárias · ${year}`} subtitle="Agentes públicos com mais diárias pagas" src={src.pmfDiarias(year)}>
              <div className="table-wrap -mx-4 sm:-mx-5">
                <table className="data">
                  <tbody>
                    {perDiems.map((d) => (
                      <tr key={d.beneficiary}>
                        <td>
                          {titleCase(d.beneficiary)}
                          <div className="text-xs text-ink-3">
                            {d.role ?? "cargo não informado"} · {int(d.n)} empenho(s)
                          </div>
                        </td>
                        <td className="r">{brlCompact(d.cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {perDiems.length === 0 && <p className="text-sm text-ink-3">Sem diárias coletadas para o ano.</p>}
            </Card>
          </div>

          <Card title={`Maiores contratos publicados no PNCP · ${year}`} subtitle="Valor global do contrato; o PNCP cobre só parte das contratações do município" src={src.pncp(year)}>
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Assinatura</th>
                    <th>Fornecedor</th>
                    <th>Objeto</th>
                    <th className="r">Valor global</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.control_number}>
                      <td className="num whitespace-nowrap">{dateBr(c.signed_at)}</td>
                      <td className="min-w-40">
                        {isCnpj(c.supplier_doc) ? (
                          <Link to={`/fornecedor/${c.supplier_doc}`} className="link">
                            {titleCase(c.supplier_name)}
                          </Link>
                        ) : (
                          titleCase(c.supplier_name)
                        )}
                      </td>
                      <td className="text-ink-2">{c.object}</td>
                      <td className="r">{brl(c.global_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {contracts.length === 0 && <p className="text-sm text-ink-3">Nenhum contrato coletado para o ano.</p>}
          </Card>
          <SourceNote>Prefeitura de Florianópolis (portal e-Publica: gastos por favorecido e diárias) e PNCP (contratos).</SourceNote>
        </>
      )}
    </Page>
  );
}
