import { data, Link } from "react-router";

import { SignalList } from "~/components/signals";
import { Card, Disclaimer, Page, SourceNote, Stat, Stats } from "~/components/ui";
import { emendasByDoc, fedBySupplier, stateBySupplier, supplierByDoc } from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, ENTITY_LABEL, fedCategory, gabineteHref, int, OFFICE_LABEL, titleCase } from "~/lib/format";
import type { Route } from "./+types/fornecedor";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `${titleCase(data?.name) || "Fornecedor"} (${docLabel(data?.doc)}) — Verba SC` }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const doc = params.doc.replace(/\D/g, "");
  if (doc.length !== 14) throw data(null, { status: 404 });
  const [s, fed, emendas, state] = await Promise.all([supplierByDoc(doc), fedBySupplier(doc), emendasByDoc(doc), stateBySupplier(doc)]);
  if (!s.name && fed.length === 0 && emendas.length === 0 && state.years.length === 0 && state.contracts.length === 0) {
    throw data(null, { status: 404 });
  }
  return { doc, ...s, fed, emendas, state };
}

export default function Fornecedor({ loaderData }: Route.ComponentProps) {
  const { doc, payee, pncp, donations, services, alesc, signals, fed, emendas, state } = loaderData;
  const name = loaderData.name ?? fed[0]?.name ?? emendas[0]?.favorecido ?? state.years[0]?.name ?? state.contracts[0]?.name ?? null;
  const sum = (e: number) => payee.filter((p) => p.entity === e).reduce((s, p) => s + p.paid_cents, 0);
  const years = [...new Set(payee.map((p) => p.year))].sort((a, b) => b - a);
  return (
    <Page kicker={`CNPJ ${docLabel(doc)}`} title={titleCase(name)}>
      <Stats>
        <Stat label="Recebeu da Prefeitura" value={brlCompact(sum(2002))} note={years.length ? `${years[years.length - 1]}–${years[0]}` : "sem registros"} />
        <Stat label="Recebeu da Câmara" value={brlCompact(sum(1018))} />
        <Stat label="Contratos no PNCP" value={int(pncp.length)} note={brlCompact(pncp.reduce((s, c) => s + c.global_cents, 0))} />
        <Stat label="Governo do Estado" value={brlCompact(state.years.reduce((s, y) => s + y.cents, 0))} note={state.contracts.length ? `${int(state.contracts.length)} contrato(s)` : "empenhos desde 2021"} />
        <Stat label="Cota parlamentar (SC)" value={brlCompact(fed.reduce((s, f) => s + f.cents, 0))} note={fed.length ? "Câmara e Senado" : "sem registros"} />
        <Stat label="Campanhas atendidas" value={int(services.length)} note={donations.length ? `e ${int(donations.length)} doação(ões)` : undefined} />
      </Stats>

      {signals.length > 0 && (
        <Card title="Sinais para verificar">
          <SignalList rows={signals} />
        </Card>
      )}

      {payee.length > 0 && (
        <Card title="Pagamentos do município, por ano" subtitle="Empenhos emitidos no ano">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th>Órgão</th>
                  <th className="r">Empenhado</th>
                  <th className="r">Pago</th>
                  <th>Arquivo</th>
                </tr>
              </thead>
              <tbody>
                {payee.map((p) => (
                  <tr key={`${p.year}-${p.entity}`}>
                    <td className="num">{p.year}</td>
                    <td>{ENTITY_LABEL[p.entity]}</td>
                    <td className="r">{brl(p.committed_cents)}</td>
                    <td className="r font-medium">{brl(p.paid_cents)}</td>
                    <td>
                      {p.r2_key && (
                        <Link to={`/bruto/${p.r2_key}`} reloadDocument className="link text-xs">
                          JSON oficial
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(state.years.length > 0 || state.contracts.length > 0) && (
        <Card title="Governo do Estado de SC" subtitle="Empenhos líquidos por ano e órgão, e contratos assinados">
          {state.years.length > 0 && (
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Ano</th>
                    <th>Órgão</th>
                    <th className="r">Empenhos</th>
                    <th className="r">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {state.years.map((y, i) => (
                    <tr key={i}>
                      <td className="num">{y.year}</td>
                      <td>{y.orgao}</td>
                      <td className="r">{int(y.n)}</td>
                      <td className="r">{brl(y.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {state.contracts.length > 0 && (
            <div className="table-wrap mt-4 -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Assinatura</th>
                    <th>Contrato</th>
                    <th className="r">Valor atual</th>
                  </tr>
                </thead>
                <tbody>
                  {state.contracts.map((c, i) => (
                    <tr key={i}>
                      <td className="num whitespace-nowrap">{dateBr(c.signed_at)}</td>
                      <td>
                        {c.object}
                        <div className="text-xs text-ink-3">
                          {c.number} · {c.ug} · {c.modality} · {c.status}
                        </div>
                      </td>
                      <td className="r">{brl(c.current_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {emendas.length > 0 && (
        <Card title="Recebeu de emendas parlamentares de SC" subtitle="Pagamentos a este CNPJ por emendas de deputados federais, senadores ou da bancada de SC">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th>Autor da emenda</th>
                  <th className="r">Emendas</th>
                  <th className="r">Recebido</th>
                </tr>
              </thead>
              <tbody>
                {emendas.map((e, i) => (
                  <tr key={i}>
                    <td className="num">{e.year}</td>
                    <td>
                      {e.slug ? (
                        <Link to={`/pessoa/${e.slug}`} className="link">
                          {titleCase(e.author_name)}
                        </Link>
                      ) : (
                        titleCase(e.author_name)
                      )}
                    </td>
                    <td className="r">{int(e.n)}</td>
                    <td className="r">{brl(e.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {fed.length > 0 && (
        <Card title="Pago pela cota parlamentar de deputados federais e senadores de SC" subtitle="Câmara dos Deputados (CEAP) e Senado (CEAPS)">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th>Parlamentar</th>
                  <th>Categoria</th>
                  <th className="r">Valor</th>
                </tr>
              </thead>
              <tbody>
                {fed.map((f, i) => (
                  <tr key={i}>
                    <td className="num">{f.year}</td>
                    <td>
                      {f.slug ? (
                        <Link to={`/pessoa/${f.slug}`} className="link">
                          {f.name}
                        </Link>
                      ) : (
                        f.name
                      )}
                      <div className="text-xs text-ink-3">{f.house === "camara" ? "Câmara" : "Senado"} · {int(f.n)} lançamento(s)</div>
                    </td>
                    <td className="text-ink-2">{fedCategory(f.category)}</td>
                    <td className="r">{brl(f.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {(services.length > 0 || donations.length > 0) && (
        <Card title="Relação com campanhas eleitorais" subtitle="Dados declarados pelos candidatos ao TSE">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Eleição</th>
                  <th>Candidato(a)</th>
                  <th>Relação</th>
                  <th className="r">Valor</th>
                </tr>
              </thead>
              <tbody>
                {[...services.map((s) => ({ ...s, rel: "Prestou serviço" })), ...donations.map((d) => ({ ...d, rel: "Doou" }))]
                  .sort((a, b) => b.year - a.year)
                  .map((r, i) => (
                    <tr key={i}>
                      <td className="num">{r.year}</td>
                      <td>
                        <Link to={`/pessoa/${r.slug}`} className="link">
                          {r.ballot_name}
                        </Link>
                        <div className="text-xs text-ink-3">
                          {OFFICE_LABEL[r.office] ?? r.office}
                          {r.elected ? " · eleito(a)" : ""}
                        </div>
                      </td>
                      <td>{r.rel}</td>
                      <td className="r">{brl(r.cents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pncp.length > 0 && (
        <Card title="Contratos com a Prefeitura no PNCP">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Assinatura</th>
                  <th>Objeto</th>
                  <th className="r">Valor global</th>
                </tr>
              </thead>
              <tbody>
                {pncp.map((c) => (
                  <tr key={c.control_number}>
                    <td className="num whitespace-nowrap">{dateBr(c.signed_at)}</td>
                    <td>
                      {c.object}
                      <div className="text-xs text-ink-3">{c.control_number}</div>
                    </td>
                    <td className="r">{brl(c.global_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {alesc.length > 0 && (
        <Card title="Possíveis pagamentos pela verba de gabinete da ALESC" subtitle="Mesmo nome normalizado; a ALESC não publica CNPJ, então confira antes de concluir">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <tbody>
                {alesc.map((a, i) => (
                  <tr key={i}>
                    <td className="num">{a.year}</td>
                    <td>
                      <Link to={gabineteHref(a.account, a.slug)} className="link">
                        {a.account}
                      </Link>
                    </td>
                    <td className="r">{brl(a.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <SourceNote>e-Publica (Prefeitura e Câmara de Florianópolis), PNCP, TSE e ALESC.</SourceNote>
      <Disclaimer />
    </Page>
  );
}
