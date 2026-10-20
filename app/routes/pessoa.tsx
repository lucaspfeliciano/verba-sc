import { data, Link } from "react-router";

import { AlescSection } from "~/components/alesc";
import { EmendasSection } from "~/components/emendas";
import { FedSection } from "~/components/federal";
import { SignalList } from "~/components/signals";
import { BarList, Card, Disclaimer, Page, Pill, SourceNote, Stat, Stats } from "~/components/ui";
import {
  alescAccountDetail,
  campaignDetail,
  emendasForPolitician,
  one,
  stateDirectPayments,
  fedDetail,
  gabinetePayments,
  perDiemsByName,
  politicianBySlug,
  signalsForPolitician,
  staffByOffice,
} from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, int, isCnpj, OFFICE_LABEL, titleCase } from "~/lib/format";
import type { Route } from "./+types/pessoa";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const p = data?.politician;
  return [
    { title: p ? `${p.ballot_name}: gastos e campanha — Verba SC` : "Verba SC" },
    { name: "description", content: p ? `Verba de gabinete, assessores, diárias e contas de campanha de ${titleCase(p.name)}.` : "" },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const base = await politicianBySlug(params.slug);
  if (!base) throw data(null, { status: 404 });
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("ano")) || null;
  const { politician, candidacies, links } = base;

  const alescAccounts = links.filter((l) => l.source === "alesc").map((l) => l.alias);
  const cmfOffice = links.find((l) => l.source === "cmf")?.alias ?? null;
  const withMoney = candidacies.filter((c) => c.receipts > 0 || c.expenses > 0);
  const chosenSq = url.searchParams.get("campanha");
  const campaign = withMoney.find((c) => c.sq_candidato === chosenSq) ?? withMoney.find((c) => c.elected) ?? withMoney[0] ?? null;

  const [alesc, staff, perDiems, signals, camp] = await Promise.all([
    alescAccountDetail(alescAccounts, year),
    cmfOffice ? staffByOffice(cmfOffice) : null,
    perDiemsByName(politician.name_norm),
    signalsForPolitician(politician.id),
    campaign ? campaignDetail(campaign.sq_candidato) : null,
  ]);
  const payments = alesc ? await gabinetePayments(politician.id, alesc.year) : null;
  const camaraIds = links.filter((l) => l.source === "camara").map((l) => l.alias);
  const senadoIds = links.filter((l) => l.source === "senado").map((l) => l.alias);
  const [camara, senado, emendas] = await Promise.all([
    fedDetail("camara", camaraIds, year),
    fedDetail("senado", senadoIds, year),
    emendasForPolitician(politician.id),
  ]);
  const govTerms = candidacies.filter((c) => (c.office === "GOVERNADOR" || c.office === "VICE-GOVERNADOR") && c.elected);
  const cpfRow = govTerms.length ? await one<{ cpf: string | null }>("SELECT cpf FROM politician WHERE id = ?1", politician.id) : null;
  const direct = cpfRow?.cpf ? await stateDirectPayments(cpfRow.cpf) : [];
  return { politician, candidacies, links, alesc, payments, camara, senado, emendas, govTerms, direct, cmfOffice, staff, perDiems, signals, campaign, camp };
}

export default function Pessoa({ loaderData }: Route.ComponentProps) {
  const { politician: p, candidacies, links, alesc, payments, camara, senado, emendas, govTerms, direct, cmfOffice, staff, perDiems, signals, campaign, camp } = loaderData;
  const latest = candidacies[0];
  const elected = candidacies.filter((c) => c.elected);
  const perDiemTotal = perDiems.reduce((s, x) => s + x.paid_cents, 0);
  return (
    <Page
      kicker={latest ? `${OFFICE_LABEL[latest.office] ?? latest.office} · ${latest.party ?? ""}` : undefined}
      title={p.ballot_name}
      intro={
        <div className="space-y-2">
          <p>{titleCase(p.name)}</p>
          <div className="flex flex-wrap gap-1.5">
            {elected.map((c) => (
              <Pill key={c.sq_candidato}>
                Eleito(a) {OFFICE_LABEL[c.office]?.toLowerCase() ?? c.office} em {c.year}
              </Pill>
            ))}
          </div>
        </div>
      }
    >
      <Stats>
        <Stat label="Candidaturas no recorte" value={int(candidacies.length)} note={candidacies.map((c) => c.year).join(", ")} />
        <Stat
          label="Verba de gabinete (ALESC)"
          value={alesc ? brlCompact(alesc.yearly.reduce((s, y) => s + y.cents, 0)) : "–"}
          note={alesc ? `${alesc.yearly[0].year}–${alesc.yearly[alesc.yearly.length - 1].year}` : "sem mandato na ALESC no período"}
        />
        <Stat
          label="Cota no Congresso"
          value={camara || senado ? brlCompact([...(camara?.yearly ?? []), ...(senado?.yearly ?? [])].reduce((s, y) => s + y.cents, 0)) : "–"}
          note={camara ? "Câmara dos Deputados" : senado ? "Senado Federal" : "sem mandato federal no período"}
        />
        <Stat
          label="Assessores na Câmara"
          value={staff ? brlCompact(staff.total) : "–"}
          note={staff ? `${int(staff.staff.length)} pessoas, em ${staff.month}` : "sem gabinete na Câmara"}
        />
        <Stat label="Sinais" value={int(signals.length)} note={signals.length ? "ver abaixo" : "nenhum"} />
      </Stats>

      {signals.length > 0 && (
        <Card title="Sinais para verificar">
          <SignalList rows={signals} showPerson={false} />
        </Card>
      )}

      {alesc && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Mandato na ALESC</h2>
          <p className="text-sm text-ink-3">Conta(s) na ALESC: {links.filter((l) => l.source === "alesc").map((l) => l.alias).join(", ")}.</p>
          <AlescSection d={alesc} payments={payments ?? undefined} />
        </section>
      )}

      {camara && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Mandato na Câmara dos Deputados</h2>
          <FedSection d={camara} />
        </section>
      )}

      {senado && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Mandato no Senado Federal</h2>
          {senado.info?.role && senado.info.role !== "Titular" && (
            <p className="text-sm text-ink-3">Exerceu o mandato como {senado.info.role.toLowerCase()}.</p>
          )}
          <FedSection d={senado} />
        </section>
      )}

      {govTerms.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">No Governo do Estado</h2>
          <Card
            title="Mandatos no Executivo estadual"
            action={
              <Link to="/governo" className="link text-sm">
                Ver gastos do Governo
              </Link>
            }
          >
            <ul className="space-y-1 text-sm">
              {govTerms.map((t) => (
                <li key={t.sq_candidato}>
                  {OFFICE_LABEL[t.office]}, eleito(a) em {t.year} · mandato {t.year + 1}–{t.year + 4} · {t.party}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-ink-2">
              A página do Governo mostra, ano a ano, os gastos por órgão, o Gabinete do Governador, a Vice-Governadoria, a
              Comunicação e os contratos.
            </p>
          </Card>
          <Card title="Pagos diretamente a esta pessoa pelo Estado" subtitle="Empenhos em que o credor é o próprio governante (pelo CPF do TSE), desde 2021">
            {direct.length === 0 ? (
              <p className="text-sm text-ink-3">Nenhum empenho em nome desta pessoa nos dados coletados.</p>
            ) : (
              <div className="table-wrap -mx-4 sm:-mx-5">
                <table className="data">
                  <tbody>
                    {direct.map((r, i) => (
                      <tr key={i}>
                        <td className="num whitespace-nowrap">{dateBr(r.issued_at)}</td>
                        <td>
                          {r.element}
                          <div className="text-xs text-ink-3">{r.orgao}</div>
                          {r.history && <div className="text-xs text-ink-3">{r.history}</div>}
                        </td>
                        <td className="r">{brl(r.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>
      )}

      {emendas && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Emendas parlamentares</h2>
          <EmendasSection d={emendas} />
        </section>
      )}

      {staff && (
        <Card
          title={`Gabinete na Câmara Municipal · ${staff.month}`}
          subtitle={`${cmfOffice}: ${int(staff.staff.length)} comissionados, ${brl(staff.total)} em vencimentos brutos no mês`}
        >
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Cargo</th>
                  <th>Admissão</th>
                  <th className="r">Bruto no mês</th>
                </tr>
              </thead>
              <tbody>
                {staff.staff.map((s) => (
                  <tr key={s.name}>
                    <td>{titleCase(s.name)}</td>
                    <td className="text-ink-2">{titleCase(s.role)}</td>
                    <td className="num">{dateBr(s.admitted_at)}</td>
                    <td className="r">{brl(s.gross_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote>Câmara Municipal de Florianópolis, portal e-Publica, cargos comissionados.</SourceNote>
        </Card>
      )}

      {perDiems.length > 0 && (
        <Card title="Diárias pagas pela Prefeitura" subtitle={`${int(perDiems.length)} empenho(s), ${brl(perDiemTotal)} pagos`}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Emissão</th>
                  <th>Cargo informado</th>
                  <th>Unidade</th>
                  <th className="r">Pago</th>
                </tr>
              </thead>
              <tbody>
                {perDiems.map((d, i) => (
                  <tr key={i}>
                    <td className="num">{dateBr(d.issued_at)}</td>
                    <td>{d.role ?? "–"}</td>
                    <td className="text-ink-2">{d.unit}</td>
                    <td className="r">{brl(d.paid_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote>Prefeitura de Florianópolis, portal e-Publica, diárias. Ligação pelo nome completo.</SourceNote>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">Campanhas eleitorais</h2>
        <Card>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Eleição</th>
                  <th>Cargo</th>
                  <th>Resultado</th>
                  <th className="r">Receitas</th>
                  <th className="r">Despesas</th>
                  <th className="r">Bens declarados</th>
                </tr>
              </thead>
              <tbody>
                {candidacies.map((c) => (
                  <tr key={c.sq_candidato} className={campaign?.sq_candidato === c.sq_candidato ? "bg-surface-2" : ""}>
                    <td className="num">
                      {c.receipts > 0 || c.expenses > 0 ? (
                        <Link to={`?campanha=${c.sq_candidato}`} preventScrollReset className="link">
                          {c.year}
                        </Link>
                      ) : (
                        c.year
                      )}
                    </td>
                    <td>
                      {OFFICE_LABEL[c.office] ?? c.office} <span className="text-xs text-ink-3">{c.party}</span>
                    </td>
                    <td className="text-ink-2">{titleCase(c.result)}</td>
                    <td className="r">{c.receipts ? brlCompact(c.receipts) : "–"}</td>
                    <td className="r">{c.expenses ? brlCompact(c.expenses) : "–"}</td>
                    <td className="r">{c.assets ? brlCompact(c.assets) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-ink-3">Contas de campanha disponíveis a partir de 2018. Clique no ano para ver o detalhe.</p>
        </Card>

        {campaign && camp && (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card title={`Maiores doadores · ${campaign.year}`} subtitle="Inclui repasses de partido e recursos próprios">
              <BarList
                items={camp.donors.map((d, i) => ({
                  key: `${d.donor_doc}-${i}`,
                  label: d.donor_name ?? "Não informado",
                  href: isCnpj(d.donor_doc) ? `/fornecedor/${d.donor_doc}` : undefined,
                  cents: d.cents,
                  note: [d.origin, docLabel(d.donor_doc)].filter(Boolean).join(" · "),
                }))}
              />
            </Card>
            <Card title={`Maiores fornecedores · ${campaign.year}`} subtitle="Despesas contratadas pela campanha">
              <BarList
                items={camp.suppliers.map((s, i) => ({
                  key: `${s.supplier_doc}-${i}`,
                  label: s.supplier_name ?? "Não informado",
                  href: isCnpj(s.supplier_doc) ? `/fornecedor/${s.supplier_doc}` : undefined,
                  cents: s.cents,
                  note: [s.category, docLabel(s.supplier_doc)].filter(Boolean).join(" · "),
                }))}
              />
            </Card>
            {camp.assets.length > 0 && (
              <Card title={`Bens declarados · ${campaign.year}`} subtitle="Declaração entregue no registro da candidatura">
                <div className="table-wrap -mx-4 sm:-mx-5">
                  <table className="data">
                    <tbody>
                      {camp.assets.map((a, i) => (
                        <tr key={i}>
                          <td>
                            {a.kind}
                            {a.description && <div className="text-xs text-ink-3">{a.description}</div>}
                          </td>
                          <td className="r">{brl(a.amount_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        )}
        <SourceNote>TSE, dados abertos: candidaturas, prestação de contas eleitorais e bens de candidatos.</SourceNote>
      </section>
      <Disclaimer />
    </Page>
  );
}
