import { Link } from "react-router";

import type { emendasForPolitician } from "~/lib/db.server";
import { brl, dateBr, docLabel, int, titleCase } from "~/lib/format";
import { BarList, Card, Columns, SourceNote } from "./ui";

type Data = NonNullable<Awaited<ReturnType<typeof emendasForPolitician>>>;

export const EMENDAS_SOURCE = "https://portaldatransparencia.gov.br/emendas";

export function EmendasNote() {
  return (
    <p className="text-sm text-ink-2">
      “Executado” soma o valor pago no ano da emenda e os restos a pagar pagos nos anos seguintes. Quem recebe pode ser a
      prefeitura, um fundo de saúde, uma entidade ou uma empresa; nas transferências especiais, o dinheiro passa por conta
      bancária, e por isso o Banco do Brasil ou a Caixa aparecem como favorecidos.
    </p>
  );
}

export function EmendasSection({ d }: { d: Data }) {
  const total = d.yearly.reduce((s, y) => s + y.executed, 0);
  return (
    <div className="space-y-6">
      <Card title="Emendas parlamentares, por ano" subtitle={`${int(d.yearly.reduce((s, y) => s + y.n, 0))} emendas, ${brl(total)} executados`}>
        <Columns items={d.yearly.map((y) => ({ key: String(y.year), label: String(y.year).slice(2), cents: y.executed }))} />
        <div className="mt-4">
          <EmendasNote />
        </div>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Para onde foi" subtitle="Localidade de aplicação do recurso">
          <BarList
            items={d.municipios.map((m) => ({
              key: m.municipio,
              label: titleCase(m.municipio),
              cents: m.executed,
              note: `${int(m.n)} emenda(s)${m.uf ? ` · ${titleCase(m.uf)}` : ""}`,
            }))}
          />
        </Card>
        <Card title="Quem recebeu" subtitle="Favorecidos dos pagamentos, com CNPJ/CPF">
          <BarList
            items={d.favorecidos.map((f, i) => ({
              key: `${f.doc}-${i}`,
              label: titleCase(f.name),
              href: f.doc?.length === 14 ? `/fornecedor/${f.doc}` : undefined,
              cents: f.cents,
              note: [docLabel(f.doc), f.natureza, f.municipio && titleCase(f.municipio)].filter(Boolean).join(" · "),
            }))}
          />
        </Card>
      </div>
      {d.convenios.length > 0 && (
        <Card title="Maiores convênios" subtitle="Objeto e entidade conveniada">
          <div className="table-wrap -mx-4 sm:-mx-5">
            <table className="data">
              <thead>
                <tr>
                  <th>Publicação</th>
                  <th>Convenente / objeto</th>
                  <th className="r">Valor</th>
                </tr>
              </thead>
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
      <SourceNote>
        <a className="link" href={EMENDAS_SOURCE} rel="noreferrer">
          Portal da Transparência (CGU), emendas parlamentares
        </a>
        .
      </SourceNote>
    </div>
  );
}

export function AuthorLink({ name, slug }: { name: string; slug: string | null }) {
  return slug ? (
    <Link to={`/pessoa/${slug}`} className="link">
      {titleCase(name)}
    </Link>
  ) : (
    <>{titleCase(name)}</>
  );
}
