import { Link } from "react-router";

import { CATEGORY_HOW, CATEGORY_NATUREZAS, categoryForNatureza, KIND_LABEL, recipientKind, type RecipientKind } from "~/lib/alesc-map";
import type { PaymentGroup } from "~/lib/db.server";
import { brl, brlCompact, docLabel, titleCase } from "~/lib/format";

export function KindBadge({ kind }: { kind: RecipientKind }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-2">
      {KIND_LABEL[kind]}
    </span>
  );
}

function Recipient({ r }: { r: PaymentGroup }) {
  const name = titleCase(r.credor);
  return (
    <>
      {r.doc ? (
        <Link to={`/fornecedor/${r.doc}`} className="link">
          {name}
        </Link>
      ) : (
        name
      )}
      <span className="ml-1.5 text-xs text-ink-3">{r.doc ? docLabel(r.doc) : r.doc_fmt}</span>
    </>
  );
}

export function ScopeNote({ scoped, year }: { scoped: boolean; year: number }) {
  if (scoped) return null;
  return (
    <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-ink-2">
      Até 2023 a ALESC não separava, nos pagamentos, as despesas dos gabinetes das demais compras da Casa. Para {year}, os
      credores abaixo são todos os que a Assembleia pagou nessa natureza de despesa, não só os dos gabinetes.
    </p>
  );
}

/** Para cada verba de gabinete do ano: quanto os gabinetes declararam e quem a ALESC pagou de fato. */
export function RecipientsByCategory({
  year,
  categories,
  recipients,
}: {
  year: number;
  categories: { category: string; cents: number; accounts: number }[];
  recipients: { scoped: boolean; rows: PaymentGroup[] };
}) {
  return (
    <div className="space-y-4">
      <ScopeNote scoped={recipients.scoped} year={year} />
      <div className="divide-y divide-line">
        {categories.map((c) => {
          const nat = CATEGORY_NATUREZAS[c.category] ?? [];
          const rows = recipients.rows.filter((r) => nat.includes(r.natureza));
          const top = rows.slice(0, 4);
          return (
            <div key={c.category} className="grid gap-2 py-4 first:pt-0 last:pb-0 md:grid-cols-[14rem_1fr]">
              <div>
                <p className="font-medium">{titleCase(c.category)}</p>
                <p className="num text-sm text-ink-2">{brlCompact(c.cents)} nos gabinetes</p>
              </div>
              <div className="space-y-2">
                {CATEGORY_HOW[c.category] && <p className="text-sm text-ink-2">{CATEGORY_HOW[c.category]}</p>}
                {top.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {top.map((r, i) => (
                      <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="min-w-0">
                          <Recipient r={r} /> <KindBadge kind={recipientKind(r)} />
                        </span>
                        <span className="num shrink-0">{brlCompact(r.cents)}</span>
                      </li>
                    ))}
                    {rows.length > top.length && <li className="text-xs text-ink-3">e mais {rows.length - top.length} credor(es)</li>}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-3">Nenhum pagamento identificado nessa natureza de despesa.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Pagamentos da ALESC atribuídos ao gabinete de um deputado (pelo campo complemento). */
export function GabinetePayments({ year, rows }: { year: number; rows: (PaymentGroup & { liquid_docs: string })[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        {year < 2024
          ? "A ALESC só passou a identificar o gabinete de referência nos pagamentos em 2024."
          : "Nenhum pagamento da ALESC identificado para este gabinete no ano."}
      </p>
    );
  }
  return (
    <div className="table-wrap -mx-4 sm:-mx-5">
      <table className="data">
        <thead>
          <tr>
            <th>Quem recebeu</th>
            <th>Tipo</th>
            <th>Verba</th>
            <th className="r">Pago</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cat = categoryForNatureza(r.natureza);
            return (
              <tr key={i}>
                <td className="min-w-48">
                  <Recipient r={r} />
                  <div className="text-xs text-ink-3">
                    {r.n} pagamento(s){r.liquid_docs ? ` · ${r.liquid_docs.split(",").slice(0, 3).join(", ")}${r.liquid_docs.split(",").length > 3 ? "…" : ""}` : ""}
                  </div>
                </td>
                <td>
                  <KindBadge kind={recipientKind(r)} />
                </td>
                <td className="text-ink-2">{cat ? titleCase(cat) : r.subelemento}</td>
                <td className="r">{brl(r.cents)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
