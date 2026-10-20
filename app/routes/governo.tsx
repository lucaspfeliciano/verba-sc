import { Link } from "react-router";

import { BarList, Card, Page, SourceNote, Stat, Stats, YearTabs } from "~/components/ui";
import { governors, stateDirectPayments, stateFocusDetail, stateOverview, stateYears } from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, int, isCnpj, OFFICE_LABEL, titleCase } from "~/lib/format";
import type { Route } from "./+types/governo";
import { ds, src } from "~/lib/sources";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `Governo de Santa Catarina: despesas de ${data?.year ?? ""} — Verba SC` }];
}

const SOURCE = "https://dados.sc.gov.br/organization/secretaria-de-estado-da-fazenda";

export async function loader({ request }: Route.LoaderArgs) {
  const years = await stateYears();
  const asked = Number(new URL(request.url).searchParams.get("ano"));
  const year = years.includes(asked) ? asked : years[0];
  const govs = await governors();
  if (!year) return { years, year: null, govs, inOffice: [], overview: null, focus: [], direct: [] };
  // Quem governava no ano: eleitos na eleição anterior (mandato de 4 anos a partir do ano seguinte).
  const inOffice = govs.filter((g) => year >= g.year + 1 && year <= g.year + 4);
  const overview = await stateOverview(year);
  const focus = await Promise.all(overview.focus.map(async (f) => ({ ...f, detail: await stateFocusDetail(year, f.orgao) })));
  const direct = (
    await Promise.all(inOffice.map(async (g) => ({ g, rows: (await stateDirectPayments(g.cpf)).filter((r) => r.year === year) })))
  ).filter((d) => d.rows.length > 0);
  return { years, year, govs: govs.map(({ cpf: _cpf, ...g }) => g), inOffice: inOffice.map(({ cpf: _cpf, ...g }) => g), overview, focus, direct: direct.map((d) => ({ g: { slug: d.g.slug, ballot_name: d.g.ballot_name, office: d.g.office }, rows: d.rows })) };
}

export default function Governo({ loaderData }: Route.ComponentProps) {
  const { years, year, govs, inOffice, overview, focus, direct } = loaderData;
  const mandates = [...new Set(govs.map((g) => g.year))];
  return (
    <Page
      kicker="Poder Executivo de Santa Catarina"
      title="Governo do Estado"
      intro={
        <p>
          Empenhos do Governo de SC por órgão e credor, os gastos do Gabinete do Governador, da Vice-Governadoria e da
          Secretaria de Comunicação (publicidade), e os contratos assinados. Empenho é o valor comprometido pelo Estado; o
          site usa o valor líquido (emissões e reforços menos anulações e estornos).
        </p>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mandates.slice(0, 3).map((y) => (
          <div key={y} className="rounded-xl border border-line bg-surface px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-ink-3">
              Eleitos em {y} · mandato {y + 1}–{y + 4}
            </p>
            {govs
              .filter((g) => g.year === y)
              .map((g) => (
                <p key={g.slug + g.office} className="mt-1">
                  <Link to={`/pessoa/${g.slug}`} className="link font-semibold">
                    {g.ballot_name}
                  </Link>{" "}
                  <span className="text-sm text-ink-3">
                    {OFFICE_LABEL[g.office]} · {g.party}
                  </span>
                </p>
              ))}
          </div>
        ))}
      </div>

      {!year || !overview ? (
        <p className="text-ink-3">Ainda não há dados do Estado coletados.</p>
      ) : (
        <>
          <YearTabs years={years} current={year} />
          {inOffice.length > 0 && (
            <p className="text-sm text-ink-2">
              Em {year}, governavam {inOffice.map((g) => `${g.ballot_name} (${OFFICE_LABEL[g.office]?.toLowerCase()})`).join(" e ")}.
            </p>
          )}
          <Stats>
            <Stat label={`Empenhado em ${year}`} value={brlCompact(overview.totals?.cents)} note="valor líquido, todos os órgãos" src={src.estado(year)} />
            <Stat label="Credores" value={int(overview.totals?.payees)} />
            {overview.focus.slice(0, 2).map((f) => (
              <Stat key={f.orgao} label={f.orgao.replace("Secretaria-", "").replace("Secretaria de Estado da ", "")} value={brlCompact(f.cents)} />
            ))}
          </Stats>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Por órgão · ${year}`} subtitle="Empenho líquido" src={src.estado(year)}>
              <BarList items={overview.orgaos.slice(0, 20).map((o) => ({ key: o.orgao, label: o.orgao, cents: o.cents }))} />
            </Card>
            <Card title={`Maiores credores · ${year}`} subtitle="Somando todos os órgãos; CPF sempre mascarado" src={src.estado(year)}>
              <BarList
                items={overview.payees.map((p) => ({
                  key: p.doc,
                  label: titleCase(p.name),
                  href: isCnpj(p.doc) ? `/fornecedor/${p.doc}` : undefined,
                  cents: p.cents,
                  note: `${docLabel(p.doc)} · ${int(p.orgaos)} órgão(s)`,
                }))}
              />
            </Card>
          </div>

          {direct.length > 0 && (
            <Card title={`Pago diretamente ao governador ou ao vice · ${year}`} subtitle="Empenhos em que o credor é o próprio governante (diárias, representação, ressarcimentos)">
              <div className="table-wrap -mx-4 sm:-mx-5">
                <table className="data">
                  <tbody>
                    {direct.flatMap((d) =>
                      d.rows.map((r, i) => (
                        <tr key={`${d.g.slug}-${i}`}>
                          <td className="num whitespace-nowrap">{dateBr(r.issued_at)}</td>
                          <td>
                            <Link to={`/pessoa/${d.g.slug}`} className="link">
                              {d.g.ballot_name}
                            </Link>
                            <div className="text-xs text-ink-3">
                              {r.element} · {r.orgao}
                            </div>
                            {r.history && (
                              <div className="line-clamp-2 text-xs text-ink-3" title={r.history}>
                                {r.history}
                              </div>
                            )}
                          </td>
                          <td className="r">{brl(r.amount_cents)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {focus.map((f) => (
            <section key={f.orgao} className="space-y-3">
              <h2 className="text-xl font-semibold">
                {f.orgao} <span className="num text-base font-normal text-ink-3">· {brl(f.cents)}</span>
              </h2>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Quem recebeu" subtitle="Credores do órgão no ano" src={src.estado(year)}>
                  <BarList
                    items={f.detail.payees.map((p) => ({
                      key: p.doc,
                      label: titleCase(p.name),
                      href: isCnpj(p.doc) ? `/fornecedor/${p.doc}` : undefined,
                      cents: p.cents,
                      note: `${docLabel(p.doc)} · ${int(p.n)} empenho(s)`,
                    }))}
                  />
                </Card>
                <Card title="Em quê" subtitle="Tipo de despesa (subelemento)" src={src.estado(year)}>
                  <BarList items={f.detail.elements.map((e) => ({ key: e.element, label: e.element, cents: e.cents }))} />
                </Card>
              </div>
              <Card title="Maiores empenhos" subtitle="Histórico informado pelo órgão e modalidade de contratação" src={src.estado(year)}>
                <div className="table-wrap -mx-4 sm:-mx-5">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Credor / histórico</th>
                        <th>Modalidade</th>
                        <th className="r">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.detail.biggest.map((b, i) => (
                        <tr key={i}>
                          <td className="num whitespace-nowrap">{dateBr(b.issued_at)}</td>
                          <td className="min-w-64">
                            {isCnpj(b.doc) ? (
                              <Link to={`/fornecedor/${b.doc}`} className="link">
                                {titleCase(b.name)}
                              </Link>
                            ) : (
                              titleCase(b.name)
                            )}{" "}
                            <span className="text-xs text-ink-3">{docLabel(b.doc)}</span>
                            <div className="text-xs text-ink-3">{b.element}</div>
                            {b.history && (
                              <div className="mt-0.5 line-clamp-3 text-xs text-ink-2" title={b.history}>
                                {b.history}
                              </div>
                            )}
                          </td>
                          <td className="text-ink-2">{b.modality}</td>
                          <td className="r">{brl(b.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </section>
          ))}

          <Card title={`Maiores contratos assinados em ${year}`} subtitle="Todos os órgãos do Executivo" src={src.estadoContratos()}>
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Assinatura</th>
                    <th>Contratado / objeto</th>
                    <th>Modalidade</th>
                    <th className="r">Valor atual</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.contracts.map((c, i) => (
                    <tr key={i}>
                      <td className="num whitespace-nowrap">{dateBr(c.signed_at)}</td>
                      <td className="min-w-64">
                        {isCnpj(c.doc) ? (
                          <Link to={`/fornecedor/${c.doc}`} className="link">
                            {titleCase(c.name)}
                          </Link>
                        ) : (
                          titleCase(c.name)
                        )}
                        <div className="text-xs text-ink-3">{c.ug}</div>
                        <div className="mt-0.5 line-clamp-2 text-xs text-ink-2" title={c.object ?? ""}>
                          {c.object}
                        </div>
                      </td>
                      <td className="text-ink-2">{c.modality}</td>
                      <td className="r">{brl(c.current_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <SourceNote>
        <a className="link" href={SOURCE} rel="noreferrer">
          Portal de Dados Abertos de SC, Secretaria de Estado da Fazenda
        </a>{" "}
        (empenhos anuais desde 2021 e contratos). Os gastos da ALESC, do Judiciário e do Ministério Público não fazem parte
        destes arquivos.
      </SourceNote>
    </Page>
  );
}
