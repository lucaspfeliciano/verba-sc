import { Link, redirect } from "react-router";

import { Card, Page } from "~/components/ui";
import { search } from "~/lib/db.server";
import { brlCompact, docLabel, int, OFFICE_LABEL, titleCase } from "~/lib/format";
import type { Route } from "./+types/busca";

export function meta() {
  return [{ title: "Busca — Verba SC" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 3) return { q, result: null };
  const result = await search(q);
  // CNPJ digitado e encontrado: vai direto para a página do fornecedor.
  if (result.doc && result.payees.length === 1) throw redirect(`/fornecedor/${result.doc}`);
  return { q, result };
}

export default function Busca({ loaderData }: Route.ComponentProps) {
  const { q, result } = loaderData;
  return (
    <Page title={q ? `Resultados para “${q}”` : "Busca"}>
      {!result ? (
        <p className="text-ink-2">Digite pelo menos 3 letras: nome de político, empresa, favorecido ou um CNPJ.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={`Pessoas (${int(result.people.length)})`}>
            {result.people.length === 0 ? (
              <p className="text-sm text-ink-3">Nenhum candidato encontrado.</p>
            ) : (
              <ul className="space-y-2">
                {result.people.map((p) => (
                  <li key={p.slug}>
                    <Link to={`/pessoa/${p.slug}`} className="link font-medium">
                      {p.ballot_name}
                    </Link>
                    <div className="text-xs text-ink-3">
                      {titleCase(p.name)} · {p.offices.split(",").map((o) => OFFICE_LABEL[o] ?? o).join(", ")} · até {p.last_year}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Favorecidos da Prefeitura e da Câmara (${int(result.payees.length)})`}>
            {result.payees.length === 0 ? (
              <p className="text-sm text-ink-3">Nenhuma empresa encontrada.</p>
            ) : (
              <ul className="space-y-2">
                {result.payees.map((p) => (
                  <li key={p.doc} className="flex justify-between gap-3">
                    <span>
                      <Link to={`/fornecedor/${p.doc}`} className="link">
                        {titleCase(p.name)}
                      </Link>
                      <span className="block text-xs text-ink-3">{docLabel(p.doc)}</span>
                    </span>
                    <span className="num shrink-0 text-sm">{brlCompact(p.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Favorecidos de gabinetes da ALESC (${int(result.alesc.length)})`} subtitle="Só nome: a ALESC não publica CNPJ">
            {result.alesc.length === 0 ? (
              <p className="text-sm text-ink-3">Nenhum favorecido encontrado.</p>
            ) : (
              <ul className="space-y-2">
                {result.alesc.map((a) => (
                  <li key={a.payee} className="flex justify-between gap-3">
                    <span>
                      {a.payee}
                      <span className="block text-xs text-ink-3">{int(a.accounts)} gabinete(s)</span>
                    </span>
                    <span className="num shrink-0 text-sm">{brlCompact(a.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Page>
  );
}
