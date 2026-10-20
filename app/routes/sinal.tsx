import { data, Link } from "react-router";

import { CycleGraph, EDGE_NAME, KIND_NAME, KindLegend, type CycleNode, type CycleStep } from "~/components/cycle-graph";
import { KindBadge, ScopeNote } from "~/components/recipients";
import { Src } from "~/components/analysis";
import { RULE_HELP, RULE_LABEL } from "~/components/signals";
import { CATEGORY_HOW, CATEGORY_NATUREZAS, recipientKind } from "~/lib/alesc-map";
import { BarList, Card, Disclaimer, Page, SeverityBadge, SourceNote, Stat, Stats } from "~/components/ui";
import {
  alescOutlierEvidence,
  alescPayeeCampaignEvidence,
  alescRecipients,
  campaignToPayeeEvidence,
  emendaCampaignEvidence,
  stateCampaignEvidence,
  fedOutlierEvidence,
  fedQuotaCampaignEvidence,
  signalByKey,
  type SignalFull,
} from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, ENTITY_LABEL, fedCategory, gabineteHref, HOUSE_LABEL, int, OFFICE_LABEL, titleCase } from "~/lib/format";
import { ds, src } from "~/lib/sources";
import type { Route } from "./+types/sinal";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [
    { title: `${data?.signal.title ?? "Sinal"} — Verba SC` },
    { name: "description", content: data?.signal.detail ?? "" },
  ];
}

export async function loader({ params }: Route.LoaderArgs) {
  const signal = await signalByKey(params.key);
  if (!signal) throw data(null, { status: 404 });
  const ev = JSON.parse(signal.evidence);
  if (signal.rule === "campanha_depois_contrato") {
    return { signal, ev, kind: "campaign" as const, campaign: await campaignToPayeeEvidence(signal, ev) };
  }
  if (signal.rule === "ciclo_dinheiro") {
    return { signal, ev, kind: "ciclo" as const };
  }
  if (signal.rule === "estado_campanha_contrato") {
    return { signal, ev, kind: "estado" as const, estado: await stateCampaignEvidence(signal, ev) };
  }
  if (signal.rule === "emenda_campanha") {
    return { signal, ev, kind: "emenda" as const, emenda: await emendaCampaignEvidence(signal) };
  }
  if (signal.rule === "cota_fornecedor_campanha") {
    return { signal, ev, kind: "fedQuota" as const, fedQuota: await fedQuotaCampaignEvidence(signal, ev) };
  }
  if (signal.rule === "cota_gasto_atipico") {
    return { signal, ev, kind: "fedOutlier" as const, fedOutlier: await fedOutlierEvidence(ev) };
  }
  if (signal.rule === "gabinete_fornecedor_campanha") {
    return { signal, ev, kind: "alescPayee" as const, alescPayee: await alescPayeeCampaignEvidence(signal, ev) };
  }
  const [outlier, recipients] = await Promise.all([
    alescOutlierEvidence(ev),
    alescRecipients(ev.year, CATEGORY_NATUREZAS[ev.category] ?? []),
  ]);
  return { signal, ev, kind: "outlier" as const, outlier, recipients };
}

export default function Sinal({ loaderData }: Route.ComponentProps) {
  const { signal } = loaderData;
  return (
    <Page
      kicker={RULE_LABEL[signal.rule] ?? signal.rule}
      title={signal.title}
      intro={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={signal.severity} />
            {signal.slug && (
              <Link to={`/pessoa/${signal.slug}`} className="link text-sm">
                {signal.ballot_name}
              </Link>
            )}
            {signal.doc && signal.doc.length === 14 && (
              <Link to={`/fornecedor/${signal.doc}`} className="link text-sm">
                CNPJ {docLabel(signal.doc)}
              </Link>
            )}
          </div>
          <p>{signal.detail}</p>
        </div>
      }
    >
      {loaderData.kind === "campaign" && <CampaignToPayee signal={signal} ev={loaderData.ev} d={loaderData.campaign} />}
      {loaderData.kind === "alescPayee" && <AlescPayee signal={signal} d={loaderData.alescPayee} />}
      {loaderData.kind === "fedQuota" && <FedQuota ev={loaderData.ev} d={loaderData.fedQuota} />}
      {loaderData.kind === "emenda" && <EmendaCampaign d={loaderData.emenda} />}
      {loaderData.kind === "estado" && <StateCampaign ev={loaderData.ev} d={loaderData.estado} />}
      {loaderData.kind === "ciclo" && <MoneyCycle ev={loaderData.ev} />}
      {loaderData.kind === "fedOutlier" && <FedOutlier ev={loaderData.ev} d={loaderData.fedOutlier} />}
      {loaderData.kind === "outlier" && <Outlier ev={loaderData.ev} d={loaderData.outlier} recipients={loaderData.recipients} />}

      <Card title="Como esta regra funciona">
        <p className="text-sm text-ink-2">{RULE_HELP[signal.rule]}</p>
        <p className="mt-2 text-xs text-ink-3">
          Regra {signal.rule} v{signal.rule_version} · calculada em {dateBr(signal.created_at)}.
        </p>
      </Card>
      <Disclaimer />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Campanha -> contrato
// ---------------------------------------------------------------------------

type CampaignData = Awaited<ReturnType<typeof campaignToPayeeEvidence>>;

function CampaignToPayee({ signal, ev, d }: { signal: SignalFull; ev: any; d: CampaignData }) {
  const entity: number = ev.entity;
  const years = d.history.filter((h) => h.entity === entity);
  const linesTotal = d.lines.reduce((s, l) => s + l.amount_cents, 0);
  const share = d.candidacy && d.candidacy.expenses > 0 && ev.role !== "doacao" ? linesTotal / d.candidacy.expenses : null;
  const role = ev.role === "doacao" ? "doação" : "serviço";
  const growth = ev.pre_avg_cents > 0 ? ev.post_avg_cents / ev.pre_avg_cents : null;
  const otherEntity = d.history.filter((h) => h.entity !== entity);
  return (
    <>
      <Stats>
        <Stat
          label={ev.role === "doacao" ? "Doou à campanha" : "Recebeu da campanha"}
          value={brl(linesTotal)}
          note={share !== null ? `${(share * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das despesas da campanha` : undefined}
        />
        <Stat label={`Média anual antes (${ev.pre_years?.[0] ?? "–"}–${ev.election})`} value={brlCompact(ev.pre_avg_cents)} note={ev.pre_years?.length ? `${ev.pre_years.length} anos com dados` : "sem dados"} />
        <Stat label="Média anual depois" value={brlCompact(ev.post_avg_cents)} note={ev.post_years?.length ? `${ev.post_years.join(", ")}` : undefined} />
        <Stat
          label="Leitura"
          value={ev.new_supplier ? "Novo" : growth !== null ? `${growth.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "–"}
          note={ev.new_supplier ? "não recebia antes da eleição" : growth !== null ? "pagamentos depois ÷ antes" : "sem base de comparação"}
        />
      </Stats>

      <Card
        src={src.tseMoney(ev.election)}
        title={`O que a campanha registrou · ${ev.election}`}
        subtitle={
          d.candidacy
            ? `${d.candidacy.ballot_name} · ${OFFICE_LABEL[d.candidacy.office] ?? d.candidacy.office} · ${d.candidacy.party ?? ""} · ${titleCase(d.candidacy.result)}`
            : undefined
        }
      >
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>{ev.role === "doacao" ? "Origem" : "Categoria"}</th>
                <th>{ev.role === "doacao" ? "Forma" : "Descrição declarada"}</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.date)}</td>
                  <td>{l.category}</td>
                  <td className="font-medium">{l.description ?? "–"}</td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.candidacy && (
          <p className="mt-3 text-sm text-ink-2">
            Para comparar: a campanha declarou {brl(d.candidacy.receipts)} em receitas e {brl(d.candidacy.expenses)} em despesas
            no total.
          </p>
        )}
        {d.lines[0] && (
          <SourceNote>
            TSE, prestação de contas eleitorais ({role}). Arquivo de origem:{" "}
            <a className="link break-all" href={d.lines[0].url.split("#")[0]} rel="noreferrer">
              {d.lines[0].url.split("#")[1] ?? d.lines[0].url}
            </a>
          </SourceNote>
        )}
      </Card>

      <Card
        src={ds(entity === 2002 ? "epublica_pmf" : "epublica_cmf", "gastos_favorecido")}
        title={`Pagamentos da ${ENTITY_LABEL[entity]} a este CNPJ, ano a ano`}
        subtitle={`Empenhos emitidos em cada ano. O ▲ marca a eleição de ${ev.election}.`}
      >
        <BeforeAfter years={years.map((y) => ({ year: y.year, cents: y.paid_cents }))} election={ev.election} />
        <div className="table-wrap mt-4 -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Ano</th>
                <th>Período</th>
                <th className="r">Empenhado</th>
                <th className="r">Pago</th>
                <th>Arquivo</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.year}>
                  <td className="num">{y.year}</td>
                  <td className="text-ink-2">{y.year <= ev.election ? "antes da eleição" : "depois da eleição"}</td>
                  <td className="r">{brl(y.committed_cents)}</td>
                  <td className="r font-medium">{brl(y.paid_cents)}</td>
                  <td>
                    {y.r2_key && (
                      <Link to={`/bruto/${y.r2_key}`} reloadDocument className="link text-xs">
                        JSON oficial
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {otherEntity.length > 0 && (
          <p className="mt-3 text-sm text-ink-2">
            Este CNPJ também recebeu {brl(otherEntity.reduce((s, h) => s + h.paid_cents, 0))} da{" "}
            {ENTITY_LABEL[otherEntity[0].entity]} no período coletado.
          </p>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Outros CNPJs da mesma empresa" subtitle="Filiais e empresas com a mesma raiz de CNPJ (8 primeiros dígitos)" src={[ds("epublica_pmf", "gastos_favorecido"), ds("epublica_cmf", "gastos_favorecido")]}>
          {d.related.length === 0 ? (
            <p className="text-sm text-ink-3">Nenhum outro CNPJ com a mesma raiz recebeu da Prefeitura ou da Câmara.</p>
          ) : (
            <BarList
              items={d.related.map((r) => ({
                key: `${r.doc}-${r.entity}`,
                label: titleCase(r.name),
                href: `/fornecedor/${r.doc}`,
                cents: r.cents,
                note: `${docLabel(r.doc)} · ${ENTITY_LABEL[r.entity]} · ${r.y0}–${r.y1}`,
              }))}
            />
          )}
        </Card>
        <Card title="Campanhas que este CNPJ atendeu" subtitle="Em todo o recorte do TSE (SC e Florianópolis)" src={[ds("tse", "despesas_contratadas")]}>
          <ul className="space-y-2 text-sm">
            {d.otherCampaigns.map((c, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span>
                  <Link to={`/pessoa/${c.slug}`} className="link">
                    {c.ballot_name}
                  </Link>{" "}
                  <span className="text-xs text-ink-3">
                    {OFFICE_LABEL[c.office] ?? c.office}, {c.year}
                    {c.elected ? ", eleito(a)" : ""}
                  </span>
                </span>
                <span className="num shrink-0">{brl(c.cents)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {d.contracts.length > 0 && (
        <Card title="Contratos no PNCP com este CNPJ" src={src.pncp()}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <tbody>
                {d.contracts.map((c) => (
                  <tr key={c.control_number}>
                    <td className="num whitespace-nowrap">{dateBr(c.signed_at)}</td>
                    <td>{c.object}</td>
                    <td className="r">{brl(c.global_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Contas da campanha no{" "}
            <a className="link" href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noreferrer">
              DivulgaCandContas (TSE)
            </a>
            : busque o candidato, abra “Prestação de contas” e procure o CNPJ {docLabel(signal.doc)}. Lá aparecem a nota fiscal e
            a descrição completa.
          </li>
          <li>
            Pagamentos no{" "}
            <a className="link" href="https://transparencia.e-publica.net/epublica-portal/#/florianopolis/portal/despesa/avancado/gastosfavorecidoTable?entidade=2002" rel="noreferrer">
              Portal da Transparência da Prefeitura
            </a>{" "}
            (Gastos por favorecido): os empenhos mostram objeto, contrato e licitação de origem.
          </li>
          <li>
            Contratos e licitações no{" "}
            <a className="link" href={`https://pncp.gov.br/app/contratos?q=${signal.doc}`} rel="noreferrer">
              PNCP
            </a>{" "}
            e no Diário Oficial do Município.
          </li>
          <li>
            Perguntas que ajudam: o contrato com a Prefeitura veio de licitação aberta? Começou antes ou depois da eleição? O
            serviço prestado à campanha tem preço compatível com o de mercado?
          </li>
        </ul>
      </Card>
    </>
  );
}

/** Colunas por ano; anos até a eleição em cinza, depois em azul, com legenda em texto. */
function BeforeAfter({ years, election }: { years: { year: number; cents: number }[]; election: number }) {
  if (years.length === 0) return <p className="text-sm text-ink-3">Sem pagamentos registrados.</p>;
  const top = Math.max(...years.map((y) => y.cents), 1);
  const currentYear = new Date().getUTCFullYear();
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--ink-3)", opacity: 0.45 }} /> Até a eleição
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--bar)" }} /> Depois da eleição
        </span>
      </div>
      <div className="flex items-end gap-1.5" style={{ height: 180 }} role="img" aria-label="Pagamentos por ano; os valores estão na tabela abaixo">
        {years.map((y) => {
          const after = y.year > election;
          return (
            <div key={y.year} className="group relative flex h-full flex-1 flex-col justify-end" title={`${y.year}: ${brl(y.cents)}${y.year === currentYear ? " (ano em curso)" : ""}`}>
              <span className="num mb-1 hidden text-center text-[10px] text-ink-3 group-hover:block">{brlCompact(y.cents)}</span>
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max(1, (y.cents / top) * 100)}%`,
                  background: after ? "var(--bar)" : "var(--ink-3)",
                  opacity: after ? (y.year === currentYear ? 0.6 : 1) : 0.45,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-[11px] text-ink-3">
        {years.map((y) => (
          <div key={y.year} className={`flex-1 text-center ${y.year === election ? "font-semibold text-ink" : ""}`}>
            {y.year === election ? `${y.year} ▲` : String(y.year).slice(2)}
          </div>
        ))}
      </div>
      {years.some((y) => y.year === currentYear) && <p className="mt-2 text-xs text-ink-3">{currentYear} ainda está em curso (barra mais clara).</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gabinete ALESC x campanha
// ---------------------------------------------------------------------------

type AlescPayeeData = Awaited<ReturnType<typeof alescPayeeCampaignEvidence>>;

function AlescPayee({ signal, d }: { signal: SignalFull; d: AlescPayeeData }) {
  const alescTotal = d.alescLines.reduce((s, l) => s + l.amount_cents, 0);
  const campTotal = d.campaignLines.reduce((s, l) => s + l.amount_cents, 0);
  const cnpj = d.campaignLines.find((l) => l.supplier_doc?.length === 14)?.supplier_doc;
  return (
    <>
      <Stats>
        <Stat label="Pago pela verba de gabinete" value={brl(alescTotal)} note={`${int(d.alescLines.length)} lançamento(s)`} />
        <Stat label="Pago pela campanha" value={brl(campTotal)} note={`${int(d.campaignLines.length)} despesa(s)`} />
        <Stat label="CNPJ na campanha" value={cnpj ? docLabel(cnpj) : "–"} note="a ALESC não informa CNPJ" />
        <Stat label="Ligação" value="Por nome" note="confira se é a mesma empresa" />
      </Stats>
      <Card title="Na campanha" subtitle="Despesas declaradas ao TSE pelo mesmo parlamentar" src={[ds("tse", "despesas_contratadas")]}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Eleição</th>
                <th>Categoria / descrição</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.campaignLines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.spent_at)}</td>
                  <td className="num">{l.year}</td>
                  <td>
                    <span className="font-medium">{l.description ?? "–"}</span>
                    <div className="text-xs text-ink-3">
                      {l.category} · {l.supplier_name}
                    </div>
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Na verba de gabinete da ALESC" subtitle="Lançamentos do gabinete com o mesmo favorecido" src={ds("alesc", "gabinetes")}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Verba</th>
                <th>Descrição</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.alescLines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.ref_date)}</td>
                  <td>{titleCase(l.category)}</td>
                  <td>
                    {l.description ?? "–"}
                    <div className="text-xs text-ink-3">{l.payee}</div>
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.alescLines[0]?.r2_key && (
          <SourceNote>
            <Link to={`/bruto/${d.alescLines[0].r2_key}`} reloadDocument className="link">
              CSV oficial da ALESC
            </Link>
            .
          </SourceNote>
        )}
      </Card>
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Os nomes coincidem, mas a ALESC não publica o CNPJ. Confirme se é a mesma empresa pedindo as notas fiscais do
            reembolso à ALESC (Lei de Acesso à Informação).
          </li>
          <li>
            Contas da campanha no{" "}
            <a className="link" href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noreferrer">
              DivulgaCandContas (TSE)
            </a>
            {signal.ballot_name ? `, candidato ${signal.ballot_name}` : ""}.
          </li>
          <li>Pergunta que ajuda: o serviço pago pela verba de gabinete foi usado na atividade parlamentar ou na campanha?</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gasto atípico na ALESC
// ---------------------------------------------------------------------------

type OutlierData = Awaited<ReturnType<typeof alescOutlierEvidence>>;

function Outlier({ ev, d, recipients }: { ev: any; d: OutlierData; recipients: Awaited<ReturnType<typeof alescRecipients>> }) {
  const subject = d.peers.find((p) => p.account === ev.account);
  const rank = d.peers.findIndex((p) => p.account === ev.account) + 1;
  const allGabinetes = d.peers.reduce((s, p) => s + p.cents, 0);
  const share = subject && allGabinetes > 0 ? subject.cents / allGabinetes : null;
  const paidTotal = recipients.rows.reduce((s, r) => s + r.cents, 0);
  const pct = (x: number) => `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
  return (
    <>
      <Stats>
        <Stat label={`Gabinete em ${ev.year}`} value={brl(subject?.cents)} note={titleCase(ev.category)} />
        <Stat label="Mediana dos colegas" value={brl(ev.median_cents)} note={`${int(ev.peers)} gabinetes`} />
        <Stat label="Posição" value={`${rank}º`} note={`de ${int(d.peers.length)}`} />
        <Stat label="Lançamentos" value={int(d.lines.length)} note="maiores listados abaixo" />
      </Stats>
      <Card
        src={src.alescPay(ev.year)}
        title={`Quem recebe esta verba · ${ev.year}`}
        subtitle="Credores que a ALESC pagou na natureza de despesa correspondente, segundo os pagamentos a credores"
      >
        <div className="space-y-3">
          {CATEGORY_HOW[ev.category] && <p className="text-sm text-ink-2">{CATEGORY_HOW[ev.category]}</p>}
          {share !== null && (
            <p className="text-sm">
              Este gabinete respondeu por <strong>{pct(share)}</strong> de tudo o que os {int(d.peers.length)} gabinetes
              gastaram em {titleCase(ev.category).toLowerCase()} em {ev.year} ({brl(subject!.cents)} de {brl(allGabinetes)}).
              {recipients.scoped && paidTotal > 0 && (
                <>
                  {" "}
                  No mesmo ano, a ALESC pagou {brl(paidTotal)} aos credores abaixo nessa despesa dos gabinetes.
                </>
              )}
            </p>
          )}
          <ScopeNote scoped={recipients.scoped} year={ev.year} />
          {recipients.rows.length === 0 ? (
            <p className="text-sm text-ink-3">Nenhum pagamento identificado nessa natureza de despesa no ano.</p>
          ) : (
            <div className="table-wrap -mx-4 sm:-mx-5">
              <table className="data">
                <thead>
                  <tr>
                    <th>Credor</th>
                    <th>Tipo</th>
                    <th className="r">Pagamentos</th>
                    <th className="r">Pago no ano</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.rows.slice(0, 12).map((r, i) => (
                    <tr key={i}>
                      <td className="min-w-48">
                        {r.doc ? (
                          <Link to={`/fornecedor/${r.doc}`} className="link">
                            {titleCase(r.credor)}
                          </Link>
                        ) : (
                          titleCase(r.credor)
                        )}
                        <div className="text-xs text-ink-3">{r.doc ? docLabel(r.doc) : r.doc_fmt}</div>
                      </td>
                      <td>
                        <KindBadge kind={recipientKind(r)} />
                      </td>
                      <td className="r">{int(r.n)}</td>
                      <td className="r">{brl(r.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <SourceNote>
          ALESC,{" "}
          <a className="link" href="https://transparencia.alesc.sc.gov.br/pagamentos/dados-abertos" rel="noreferrer">
            pagamentos a credores
          </a>
          .
        </SourceNote>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Todos os gabinetes · ${titleCase(ev.category)} · ${ev.year}`} subtitle="O gabinete do sinal está destacado" src={src.alesc(ev.year)}>
          <BarList
            items={d.peers.slice(0, 25).map((p) => ({
              key: p.account,
              label: p.account === ev.account ? <strong>{p.account} ◀</strong> : p.account,
              href: gabineteHref(p.account, p.slug),
              cents: p.cents,
            }))}
          />
        </Card>
        <Card title={`Histórico do gabinete em ${titleCase(ev.category)}`} subtitle="Total por ano" src={ds("alesc", "gabinetes")}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.year} className={h.year === ev.year ? "bg-surface-2" : ""}>
                    <td className="num">{h.year}</td>
                    <td className="r">{brl(h.cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title={`Lançamentos · ${titleCase(ev.category)} · ${ev.year}`} src={src.alesc(ev.year)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.ref_date)}</td>
                  <td>
                    {l.description ?? "–"}
                    {l.payee && <div className="text-xs text-ink-3">{l.payee}</div>}
                    {l.route && <div className="text-xs text-ink-3">Trecho: {l.route}</div>}
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.lines[0]?.r2_key && (
          <SourceNote>
            <Link to={`/bruto/${d.lines[0].r2_key}`} reloadDocument className="link">
              CSV oficial da ALESC de {ev.year}
            </Link>
            .
          </SourceNote>
        )}
      </Card>
      <Card title="Pedir os comprovantes (modelo)" subtitle="Copie e envie pelo e-SIC da ALESC, com base na Lei de Acesso à Informação">
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-4 font-sans text-sm text-ink-2">{laiText(ev)}</pre>
        <p className="mt-2 text-xs text-ink-3">
          O prazo de resposta é de 20 dias, prorrogáveis por mais 10. Se a resposta for negada, cabe recurso.
        </p>
      </Card>
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Gabinetes de deputados de regiões distantes da capital tendem a gastar mais com passagens, veículos e diárias.</li>
          <li>Veja os trechos e as datas: viagens concentradas em período eleitoral merecem atenção.</li>
          <li>
            Os comprovantes podem ser pedidos à ALESC pela{" "}
            <a className="link" href="https://transparencia.alesc.sc.gov.br/" rel="noreferrer">
              Lei de Acesso à Informação
            </a>
            .
          </li>
        </ul>
      </Card>
    </>
  );
}

const LAI_DETAIL: Record<string, string> = {
  "CORRESPONDÊNCIA / TELEGRAMA":
    "cópia das faturas dos Correios com o detalhamento dos objetos postados pelo gabinete (data, quantidade, tipo de serviço e valor), a abrangência geográfica dos envios (municípios de destino, de forma agregada) e cópia ou modelo do material enviado",
  PASSAGENS: "os bilhetes emitidos, com nome do passageiro, trecho, data da viagem e justificativa",
  "DIÁRIAS": "as solicitações de diárias, com beneficiário, destino, período e objetivo da viagem",
  "VEÍCULOS": "os comprovantes que fundamentaram as indenizações e locações, com quilometragem, trajetos e período",
  "COMBUSTÍVEIS": "os extratos do cartão de abastecimento, com data, local, veículo e quantidade abastecida",
  REEMBOLSOS: "as notas fiscais e os comprovantes apresentados para cada reembolso",
  ALUGUEL: "o contrato de locação do escritório de apoio e os recibos de pagamento",
  TELEFONE: "as faturas detalhadas das linhas usadas pelo gabinete",
};

function laiText(ev: { account: string; year: number; category: string }) {
  const what = LAI_DETAIL[ev.category] ?? "os documentos fiscais e comprovantes de cada lançamento";
  return `Com base na Lei 12.527/2011, solicito, referente às despesas da verba "${titleCase(ev.category)}" do gabinete ${ev.account} no ano de ${ev.year}:

1. ${what};
2. a relação de lançamentos com data, valor e favorecido (nome e CNPJ/CPF);
3. o normativo interno que regula o uso dessa verba pelos gabinetes e seus limites.

Solicito que as informações sejam enviadas em formato eletrônico.`;
}

// ---------------------------------------------------------------------------
// Congresso: cota x campanha
// ---------------------------------------------------------------------------

type FedQuotaData = Awaited<ReturnType<typeof fedQuotaCampaignEvidence>>;

function NotaLink({ url }: { url: string | null }) {
  return url ? (
    <a href={url} className="link text-xs" rel="noreferrer" target="_blank">
      Nota fiscal
    </a>
  ) : (
    <span className="text-xs text-ink-3">–</span>
  );
}

function FedQuota({ ev, d }: { ev: any; d: FedQuotaData }) {
  const quotaTotal = d.quotaLines.reduce((s, l) => s + l.amount_cents, 0);
  const campTotal = d.campaignLines.reduce((s, l) => s + l.amount_cents, 0);
  return (
    <>
      <Stats>
        <Stat label="Pago pela cota" value={brl(quotaTotal)} note={`${int(d.quotaLines.length)} lançamento(s) · ${HOUSE_LABEL[ev.house]}`} />
        <Stat label="Pago pela campanha" value={brl(campTotal)} note={`eleições ${ev.elections}`} />
        <Stat label="Período na cota" value={`${ev.y0}–${ev.y1}`} />
        <Stat label="Ligação" value="CNPJ" note="mesmo documento nas duas fontes" />
      </Stats>
      <Card title="Na campanha" subtitle="Despesas declaradas ao TSE pelo mesmo parlamentar" src={[ds("tse", "despesas_contratadas")]}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Eleição</th>
                <th>Descrição declarada</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.campaignLines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.spent_at)}</td>
                  <td className="num">{l.year}</td>
                  <td>
                    <span className="font-medium">{l.description ?? "–"}</span>
                    <div className="text-xs text-ink-3">{l.category}</div>
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Na cota parlamentar" subtitle="Cada lançamento, com a nota fiscal quando a Casa publica" src={ds(ev.house, ev.house === "camara" ? "ceap" : "ceaps")}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th className="r">Valor</th>
                <th>Comprovante</th>
              </tr>
            </thead>
            <tbody>
              {d.quotaLines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.issued_at)}</td>
                  <td>
                    {fedCategory(l.category)}
                    {l.detail && <div className="text-xs text-ink-3">{l.detail}</div>}
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                  <td>
                    <NotaLink url={l.document_url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Abra as notas fiscais da cota: o serviço descrito é atividade parlamentar ou parece material de campanha?</li>
          <li>Compare as datas: pagamentos pela cota perto do período eleitoral merecem atenção.</li>
          <li>
            Contas da campanha no{" "}
            <a className="link" href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noreferrer">
              DivulgaCandContas (TSE)
            </a>
            .
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Congresso: gasto atípico na cota
// ---------------------------------------------------------------------------

type FedOutlierData = Awaited<ReturnType<typeof fedOutlierEvidence>>;

function FedOutlier({ ev, d }: { ev: any; d: FedOutlierData }) {
  const subject = d.peers.find((p) => p.member_id === ev.member_id);
  const ratio = subject && ev.median_cents ? subject.cents / ev.median_cents : null;
  return (
    <>
      <Stats>
        <Stat label={`Gasto em ${ev.year}`} value={brl(subject?.cents)} note={fedCategory(ev.category)} />
        <Stat label="Mediana nacional" value={brl(ev.median_cents)} note={`${int(ev.members)} parlamentares do país`} />
        <Stat label="90% do país gasta até" value={brl(ev.p90_cents)} />
        <Stat label="Vezes a mediana" value={ratio ? `${ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "–"} />
      </Stats>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Bancada de SC · ${fedCategory(ev.category)} · ${ev.year}`} subtitle="O parlamentar do sinal está destacado" src={src.fed(ev.house, ev.year)}>
          <BarList
            items={d.peers.map((p) => ({
              key: p.member_id,
              label: p.member_id === ev.member_id ? <strong>{p.name} ◀</strong> : p.name,
              href: p.slug ? `/pessoa/${p.slug}` : undefined,
              cents: p.cents,
            }))}
          />
        </Card>
        <Card title="Histórico nesta categoria" subtitle="Gasto do parlamentar por ano, comparado com a mediana nacional" src={ds(ev.house, ev.house === "camara" ? "ceap" : "ceaps")}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Ano</th>
                  <th className="r">Gasto</th>
                  <th className="r">Mediana nacional</th>
                </tr>
              </thead>
              <tbody>
                {d.history.map((h) => (
                  <tr key={h.year} className={h.year === ev.year ? "bg-surface-2" : ""}>
                    <td className="num">{h.year}</td>
                    <td className="r">{brl(h.cents)}</td>
                    <td className="r text-ink-2">{brl(h.median_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <Card title={`Lançamentos · ${fedCategory(ev.category)} · ${ev.year}`} subtitle="Os maiores, com fornecedor e nota fiscal" src={src.fed(ev.house, ev.year)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Fornecedor</th>
                <th className="r">Valor</th>
                <th>Comprovante</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.issued_at)}</td>
                  <td className="min-w-48">
                    {l.supplier_doc?.length === 14 ? (
                      <Link to={`/fornecedor/${l.supplier_doc}`} className="link">
                        {l.supplier_name}
                      </Link>
                    ) : (
                      l.supplier_name
                    )}
                    <div className="text-xs text-ink-3">{docLabel(l.supplier_doc)}</div>
                    {l.detail && <div className="text-xs text-ink-3">{l.detail}</div>}
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                  <td>
                    <NotaLink url={l.document_url} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>Abra as notas fiscais: o fornecedor, o serviço e as datas fazem sentido para a atividade parlamentar?</li>
          <li>Veja se o gasto se concentra em poucos fornecedores ou perto do período eleitoral.</li>
          <li>
            O portal da{" "}
            <a className="link" href="https://www.camara.leg.br/transparencia/gastos-parlamentares" rel="noreferrer">
              Câmara
            </a>{" "}
            e o do{" "}
            <a className="link" href="https://www6g.senado.leg.br/transparencia/sen/" rel="noreferrer">
              Senado
            </a>{" "}
            mostram os mesmos lançamentos com filtros por mês.
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Emenda x campanha
// ---------------------------------------------------------------------------

type EmendaData = Awaited<ReturnType<typeof emendaCampaignEvidence>>;

function EmendaCampaign({ d }: { d: EmendaData }) {
  const received = d.payments.reduce((s, p) => s + p.amount_cents, 0);
  const camp = d.campaign.reduce((s, c) => s + c.amount_cents, 0);
  return (
    <>
      <Stats>
        <Stat label="Recebido de emendas" value={brl(received)} note={`${int(new Set(d.payments.map((p) => p.code)).size)} emenda(s)`} />
        <Stat label="Relação com a campanha" value={brl(camp)} note={[...new Set(d.campaign.map((c) => c.rel))].join(" e ")} />
        <Stat label="Convênios" value={int(d.convenios.length)} />
        <Stat label="Ligação" value="Documento" note="mesmo CNPJ/CPF nas duas fontes" />
      </Stats>
      <Card title="Na campanha" subtitle="Declarado ao TSE pelo mesmo parlamentar" src={[ds("tse", "receitas"), ds("tse", "despesas_contratadas")]}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Eleição</th>
                <th>Relação</th>
                <th>Descrição</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.campaign.map((c, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(c.date)}</td>
                  <td className="num">{c.year}</td>
                  <td>{c.rel}</td>
                  <td>
                    {c.description ?? "–"}
                    <div className="text-xs text-ink-3">{c.category}</div>
                  </td>
                  <td className="r">{brl(c.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Nas emendas" subtitle="Pagamentos ao mesmo CNPJ/CPF por emendas deste parlamentar" src={src.emendas()}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Mês</th>
                <th>Emenda / ação</th>
                <th>Destino</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.payments.map((p, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{p.year_month ? `${p.year_month.slice(4)}/${p.year_month.slice(0, 4)}` : "–"}</td>
                  <td>
                    <span className="font-medium">{p.acao ?? "–"}</span>
                    <div className="text-xs text-ink-3">
                      {p.code} · {p.funcao}
                    </div>
                  </td>
                  <td className="text-ink-2">{titleCase(p.municipio)}</td>
                  <td className="r">{brl(p.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {d.convenios.length > 0 && (
        <Card title="Convênios das mesmas emendas" src={src.emendas()}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <tbody>
                {d.convenios.map((c, i) => (
                  <tr key={i}>
                    <td className="num whitespace-nowrap">{dateBr(c.published_at)}</td>
                    <td>
                      <span className="font-medium">{titleCase(c.convenente)}</span>
                      <div className="text-xs text-ink-3">{c.objeto}</div>
                    </td>
                    <td className="r">{brl(c.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Consulte cada emenda pelo código no{" "}
            <a className="link" href="https://portaldatransparencia.gov.br/emendas" rel="noreferrer">
              Portal da Transparência
            </a>
            : ali estão os documentos de empenho e pagamento.
          </li>
          <li>O favorecido foi escolhido por licitação ou chamamento público? Quem executou o objeto do convênio?</li>
          <li>
            Contas da campanha no{" "}
            <a className="link" href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noreferrer">
              DivulgaCandContas (TSE)
            </a>
            .
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Governo do Estado: campanha -> empenhos
// ---------------------------------------------------------------------------

type StateData = Awaited<ReturnType<typeof stateCampaignEvidence>>;

function StateCampaign({ ev, d }: { ev: any; d: StateData }) {
  const linesTotal = d.lines.reduce((s, l) => s + l.amount_cents, 0);
  const growth = ev.pre_avg_cents > 0 ? ev.post_avg_cents / ev.pre_avg_cents : null;
  return (
    <>
      <Stats>
        <Stat label={ev.role === "doacao" ? "Doou à campanha" : "Recebeu da campanha"} value={brl(linesTotal)} note={d.candidacy ? `${OFFICE_LABEL[d.candidacy.office]}, ${ev.election}` : undefined} />
        <Stat label="Média anual antes" value={ev.pre_years?.length >= 2 ? brlCompact(ev.pre_avg_cents) : "sem dados"} note={ev.pre_years?.length ? ev.pre_years.join(", ") : "empenhos começam em 2021"} />
        <Stat label="Média anual depois" value={brlCompact(ev.post_avg_cents)} note={ev.post_years?.join(", ")} />
        <Stat
          label="Leitura"
          value={ev.new_supplier ? "Novo" : growth !== null ? `${growth.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×` : "–"}
          note={ev.new_supplier ? "não recebia antes da eleição" : growth !== null ? "depois ÷ antes" : "sem base de comparação"}
        />
      </Stats>
      <Card title={`O que a campanha registrou · ${ev.election}`} subtitle={d.candidacy ? `${d.candidacy.ballot_name} · ${d.candidacy.party ?? ""}` : undefined} src={src.tseMoney(ev.election)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <tbody>
              {d.lines.map((l, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(l.date)}</td>
                  <td>
                    <span className="font-medium">{l.description ?? "–"}</span>
                    <div className="text-xs text-ink-3">{l.category}</div>
                  </td>
                  <td className="r">{brl(l.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card src={ds("estado", "empenhos")} title="Empenhos do Governo de SC a este CNPJ/CPF, ano a ano" subtitle={`O ▲ marca a eleição de ${ev.election}; os dados do Estado começam em 2021.`}>
        <BeforeAfter years={d.history.map((h) => ({ year: h.year, cents: h.cents }))} election={ev.election} />
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Órgãos que pagaram depois da eleição" src={ds("estado", "empenhos")}>
          <BarList items={d.orgaos.map((o) => ({ key: o.orgao, label: o.orgao, cents: o.cents }))} />
        </Card>
        <Card title="Contratos com o Estado" src={src.estadoContratos()}>
          {d.contracts.length === 0 ? (
            <p className="text-sm text-ink-3">Nenhum contrato registrado para este documento.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.contracts.map((c, i) => (
                <li key={i}>
                  <span className="num">{dateBr(c.signed_at)}</span> · {brl(c.current_cents)}
                  <div className="text-xs text-ink-3">
                    {c.object} · {c.ug} · {c.modality}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Como conferir">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            Empenhos e contratos no{" "}
            <a className="link" href="https://www.transparencia.sc.gov.br/" rel="noreferrer">
              Portal da Transparência de SC
            </a>
            : busque pelo CNPJ e veja a licitação de origem.
          </li>
          <li>O contrato veio de licitação aberta ou de dispensa/inexigibilidade? Começou antes ou depois da posse?</li>
          <li>
            Contas da campanha no{" "}
            <a className="link" href="https://divulgacandcontas.tse.jus.br/divulga/" rel="noreferrer">
              DivulgaCandContas (TSE)
            </a>
            .
          </li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ciclo de dinheiro
// ---------------------------------------------------------------------------

const EDGE_SRC: Record<string, string[]> = {
  doacao: [ds("tse", "receitas")],
  campanha: [ds("tse", "despesas_contratadas")],
  cota: [ds("camara", "ceap"), ds("senado", "ceaps")],
  emenda: [ds("cgu", "emendas")],
  gabinete: [ds("alesc", "pagamentos")],
};

function NodeLink({ n }: { n: CycleNode }) {
  if (n.slug) {
    return (
      <Link to={`/pessoa/${n.slug}`} className="link">
        {n.label}
      </Link>
    );
  }
  if (n.doc && n.doc.length === 14) {
    return (
      <Link to={`/fornecedor/${n.doc}`} className="link">
        {titleCase(n.label)}
      </Link>
    );
  }
  return <>{titleCase(n.label)}</>;
}

function MoneyCycle({ ev }: { ev: { nodes: CycleNode[]; steps: CycleStep[]; total_cents: number; min_edge_cents: number; has_party: boolean; has_public: boolean } }) {
  const byKey = new Map(ev.nodes.map((n) => [n.key, n]));
  return (
    <>
      <Stats>
        <Stat label="Participantes" value={int(ev.nodes.length)} note={[...new Set(ev.nodes.map((n) => KIND_NAME[n.kind].toLowerCase()))].join(", ")} />
        <Stat label="Pode ter dado a volta" value={brl(ev.min_edge_cents)} note="a menor ligação do ciclo" />
        <Stat label="Total movimentado" value={brl(ev.total_cents)} note="soma de todas as ligações" />
        <Stat label="Dinheiro público" value={ev.has_public ? "Sim" : "Não"} note={ev.has_public ? "cota, emenda ou verba de gabinete" : "só campanha"} />
      </Stats>

      <Card title="O ciclo" subtitle="As setas seguem o dinheiro; o valor é a soma de cada ligação em todos os anos disponíveis">
        <div className="mx-auto max-w-3xl">
          <CycleGraph nodes={ev.nodes} steps={ev.steps} />
        </div>
        <div className="mt-3">
          <KindLegend />
        </div>
      </Card>

      <Card title="Cada ligação" subtitle="No Modo Análise, clique numa linha para ver os arquivos de origem">
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>De</th>
                <th>Para</th>
                <th>Tipo</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {ev.steps.map((s, i) => {
                const from = byKey.get(s.from)!;
                const to = byKey.get(s.to)!;
                return (
                  <Src as="tr" key={i} refs={s.kinds.flatMap((k) => EDGE_SRC[k.kind] ?? [])} label={`${from.label} → ${to.label}`}>
                    <td className="num text-ink-3">{i + 1}</td>
                    <td className="min-w-40">
                      <NodeLink n={from} />
                      <div className="text-xs text-ink-3">{KIND_NAME[from.kind]}</div>
                    </td>
                    <td className="min-w-40">
                      <NodeLink n={to} />
                      <div className="text-xs text-ink-3">{KIND_NAME[to.kind]}</div>
                    </td>
                    <td className="text-ink-2">
                      {s.kinds.map((k) => (
                        <div key={k.kind}>
                          {EDGE_NAME[k.kind] ?? k.kind}
                          {s.kinds.length > 1 && <span className="text-xs text-ink-3"> · {brl(k.cents)}</span>}
                        </div>
                      ))}
                    </td>
                    <td className="r font-medium">{brl(s.cents)}</td>
                  </Src>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Como ler este ciclo">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
          <li>
            O que pode ter circulado de verdade é no máximo o valor da menor ligação ({brl(ev.min_edge_cents)}). O total soma
            ligações de tamanhos muito diferentes.
          </li>
          <li>
            As ligações somam todos os anos: uma pode ser de uma eleição e a outra de anos depois. Abra as páginas de cada
            participante para ver as datas.
          </li>
          {ev.has_party && <li>Há partido no ciclo: partidos financiam candidatos e recebem sobras de campanha; isso é comum e legal.</li>}
          {ev.nodes.every((n) => n.kind === "politico") && <li>Só há candidatos no ciclo: doações entre colegas de chapa são comuns e legais.</li>}
          {ev.has_public && (
            <li>
              Há dinheiro público no ciclo. Vale conferir se o serviço pago com cota, emenda ou verba de gabinete foi prestado e
              se o fornecedor foi escolhido de forma regular.
            </li>
          )}
          <li>
            Um padrão que merece atenção: a campanha paga uma pessoa e essa pessoa doa de volta para a mesma campanha ou para
            um aliado. Pode ser um colaborador que também apoiou financeiramente, ou pode indicar dinheiro que voltou.
          </li>
        </ul>
      </Card>
    </>
  );
}

