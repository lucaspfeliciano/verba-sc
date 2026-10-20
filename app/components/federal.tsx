import { Link } from "react-router";

import type { fedDetail } from "~/lib/db.server";
import { brl, brlCompact, dateBr, docLabel, fedCategory, HOUSE_LABEL, int } from "~/lib/format";
import { BarList, Card, Columns, SourceNote, YearTabs } from "./ui";
import { ds, src } from "~/lib/sources";

type Detail = NonNullable<Awaited<ReturnType<typeof fedDetail>>>;

export const QUOTA_SOURCE: Record<string, { label: string; href: string }> = {
  camara: { label: "Câmara dos Deputados, cota parlamentar (CEAP)", href: "https://www.camara.leg.br/transparencia/gastos-parlamentares" },
  senado: { label: "Senado Federal, cota parlamentar (CEAPS)", href: "https://www6g.senado.leg.br/transparencia/sen/" },
};

export function FedSection({ d }: { d: Detail }) {
  const yearTotal = d.yearly.find((y) => y.year === d.year)?.cents ?? 0;
  const quota = QUOTA_SOURCE[d.house];
  return (
    <div className="space-y-6">
      <Card title={`Cota parlamentar (${HOUSE_LABEL[d.house]}), por ano`} subtitle="Valor reembolsado ou pago com a cota para o exercício da atividade parlamentar" src={ds(d.house, d.house === "camara" ? "ceap" : "ceaps")}>
        <Columns items={d.yearly.map((y) => ({ key: String(y.year), label: String(y.year).slice(2), cents: y.cents }))} />
        <div className="mt-4">
          <YearTabs years={d.yearly.map((y) => y.year).reverse()} current={d.year} />
        </div>
      </Card>

      <Card title={`Por categoria · ${d.year}`} subtitle={`Total no ano: ${brl(yearTotal)}. A mediana é de todos os parlamentares do país que usaram a categoria.`} src={src.fed(d.house, d.year)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Categoria</th>
                <th className="r">Gasto</th>
                <th className="r">Mediana nacional</th>
              </tr>
            </thead>
            <tbody>
              {d.categories.map((c) => {
                const ratio = c.median_cents ? c.cents / c.median_cents : null;
                return (
                  <tr key={c.category}>
                    <td>{fedCategory(c.category)}</td>
                    <td className="r font-medium">{brlCompact(c.cents)}</td>
                    <td className="r text-ink-2">
                      {brlCompact(c.median_cents)}
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

      <Card title={`Quem recebeu · ${d.year}`} subtitle="Fornecedores pagos com a cota, com CNPJ" src={src.fed(d.house, d.year)}>
        <BarList
          items={d.suppliers.map((s, i) => ({
            key: `${s.supplier_doc}-${i}`,
            label: s.supplier_name ?? "Não informado",
            href: s.supplier_doc?.length === 14 ? `/fornecedor/${s.supplier_doc}` : undefined,
            cents: s.cents,
            note: `${docLabel(s.supplier_doc)} · ${int(s.n)} lançamento(s) · ${s.categories.split(",").map(fedCategory).join(", ")}`,
          }))}
        />
      </Card>

      <Card title={`Maiores despesas · ${d.year}`} src={src.fed(d.house, d.year)}>
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria / fornecedor</th>
                <th className="r">Valor</th>
                <th>Comprovante</th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r, i) => (
                <tr key={i}>
                  <td className="num whitespace-nowrap">{dateBr(r.issued_at)}</td>
                  <td className="min-w-56">
                    {fedCategory(r.category)}
                    <div className="text-xs text-ink-3">
                      {r.supplier_doc?.length === 14 ? (
                        <Link to={`/fornecedor/${r.supplier_doc}`} className="link">
                          {r.supplier_name}
                        </Link>
                      ) : (
                        r.supplier_name
                      )}{" "}
                      {docLabel(r.supplier_doc)}
                    </div>
                    {r.detail && <div className="text-xs text-ink-3">{r.detail}</div>}
                  </td>
                  <td className="r">{brl(r.amount_cents)}</td>
                  <td>
                    {r.document_url ? (
                      <a href={r.document_url} className="link text-xs" rel="noreferrer" target="_blank">
                        Nota fiscal
                      </a>
                    ) : (
                      <span className="text-xs text-ink-3">{r.doc_number ? `doc. ${r.doc_number}` : "–"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <SourceNote>
        <a className="link" href={quota.href} rel="noreferrer">
          {quota.label}
        </a>
        .
      </SourceNote>
    </div>
  );
}
