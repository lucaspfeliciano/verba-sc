import { Link } from "react-router";

import type { alescAccountDetail, gabinetePayments } from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, int, titleCase } from "~/lib/format";
import { GabinetePayments } from "./recipients";
import { BarList, Card, Columns, SourceNote, YearTabs } from "./ui";
import { ds, src } from "~/lib/sources";

type Detail = NonNullable<Awaited<ReturnType<typeof alescAccountDetail>>>;

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

type Payments = Awaited<ReturnType<typeof gabinetePayments>>;

export function AlescSection({ d, payments }: { d: Detail; payments?: Payments }) {
  const yearTotal = d.yearly.find((y) => y.year === d.year)?.cents ?? 0;
  const monthly = MONTHS.map((label, i) => {
    const key = `${d.year}-${String(i + 1).padStart(2, "0")}`;
    return { key, label, cents: d.monthly.find((m) => m.month === key)?.cents ?? 0 };
  });
  return (
    <div className="space-y-6">
      <Card title="Verba de gabinete na ALESC, por ano" subtitle="Total pago pela Assembleia com a cota do gabinete" src={ds("alesc", "gabinetes")}>
        <Columns items={d.yearly.map((y) => ({ key: String(y.year), label: String(y.year).slice(2), cents: y.cents }))} />
        <div className="mt-4">
          <YearTabs years={d.yearly.map((y) => y.year).reverse()} current={d.year} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={`Por tipo de verba · ${d.year}`} subtitle={`Total no ano: ${brl(yearTotal)}`} src={src.alesc(d.year)}>
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Verba</th>
                  <th className="r">Gabinete</th>
                  <th className="r">Mediana dos colegas</th>
                </tr>
              </thead>
              <tbody>
                {d.categories.map((c) => {
                  const ratio = c.peer_median ? c.cents / c.peer_median : null;
                  return (
                    <tr key={c.category}>
                      <td>{titleCase(c.category)}</td>
                      <td className="r font-medium">{brlCompact(c.cents)}</td>
                      <td className="r text-ink-2">
                        {brlCompact(c.peer_median)}
                        {ratio !== null && ratio >= 1.5 && (
                          <span className="ml-1 text-xs font-medium text-ink">({ratio.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={`Mês a mês · ${d.year}`} subtitle="Pela data de referência do lançamento" src={src.alesc(d.year)}>
          <Columns items={monthly} />
          <div className="table-wrap mt-4 -mx-4 sm:-mx-5">
            <table className="data">
              <tbody>
                {monthly
                  .filter((m) => m.cents > 0)
                  .map((m) => (
                    <tr key={m.key}>
                      <td>{m.label}</td>
                      <td className="r">{brl(m.cents)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {payments && (
        <Card
          title={`Quem a ALESC pagou por este gabinete · ${d.year}`}
          subtitle="Pagamentos a credores em que a ALESC indica este deputado como referência: o destinatário real de aluguéis, combustível, veículos e reembolsos"
          src={src.alescPay(d.year)}
        >
          <GabinetePayments year={d.year} rows={payments} />
        </Card>
      )}

      <Card
        title={`Favorecidos declarados pelo gabinete · ${d.year}`}
        subtitle="Nomes informados no CSV de gabinetes. O CNPJ aparece quando o mesmo nome consta, com um único CNPJ, nos pagamentos a credores."
        src={[src.alesc(d.year), src.alescPay(d.year)]}
      >
        <BarList
          items={d.payees.map((p) => ({
            key: p.payee_norm,
            label: p.payee,
            href: p.doc ? `/fornecedor/${p.doc}` : `/busca?q=${encodeURIComponent(p.payee)}`,
            cents: p.cents,
            note: `${int(p.n)} lançamento(s) · ${titleCase(p.categories.replace(/,/g, ", "))}${p.doc ? ` · CNPJ ${docLabel(p.doc)}` : ""}`,
          }))}
          empty="A ALESC não informou favorecidos para este ano."
        />
      </Card>

      <Card title={`Maiores lançamentos · ${d.year}`} src={src.alesc(d.year)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Verba</th>
                <th>Descrição / favorecido</th>
                <th className="r">Valor</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(r.ref_date)}</td>
                  <td className="whitespace-nowrap">{titleCase(r.category)}</td>
                  <td>
                    {r.description}
                    {r.payee && <div className="text-xs text-ink-3">{r.payee}</div>}
                    {r.route && <div className="text-xs text-ink-3">Trecho: {r.route}</div>}
                  </td>
                  <td className="r">{brl(r.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.rows[0]?.r2_key && (
          <p className="mt-3 text-xs text-ink-3">
            <Link to={`/bruto/${d.rows[0].r2_key}`} reloadDocument className="link">
              Baixar o CSV oficial de {d.year}
            </Link>{" "}
            (cópia exata do arquivo da ALESC, conferível pelo SHA-256 em Fontes).
          </p>
        )}
      </Card>
      <SourceNote>ALESC, despesas dos gabinetes parlamentares.</SourceNote>
    </div>
  );
}
