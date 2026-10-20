import { Link } from "react-router";

import { Card, Page } from "~/components/ui";
import { sourcesSummary } from "~/lib/db.server";
import { dateBr, int } from "~/lib/format";
import type { Route } from "./+types/fontes";

export function meta() {
  return [{ title: "Fontes e proveniência dos dados — Verba SC" }];
}

export async function loader() {
  return sourcesSummary();
}

const SOURCE_LABEL: Record<string, string> = {
  alesc: "ALESC · Portal da Transparência",
  epublica_pmf: "Prefeitura de Florianópolis · e-Publica",
  epublica_cmf: "Câmara Municipal de Florianópolis · e-Publica",
  pncp: "PNCP · Portal Nacional de Contratações Públicas",
  tse: "TSE · Dados abertos eleitorais",
};

const mb = (b: number) => `${(b / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;

export default function Fontes({ loaderData }: Route.ComponentProps) {
  const { datasets, recent, runs, unlinked } = loaderData;
  return (
    <Page
      kicker="Proveniência"
      title="De onde vem cada número"
      intro={
        <p>
          Cada arquivo baixado de uma fonte oficial fica registrado com endereço, data e hash SHA-256, e uma cópia exata é
          guardada para download. Para conferir, baixe o arquivo na fonte e compare o hash (por exemplo,{" "}
          <code className="rounded bg-surface-2 px-1">sha256sum arquivo.csv</code>).
        </p>
      }
    >
      <Card title="Conjuntos de dados">
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Fonte</th>
                <th>Conjunto</th>
                <th className="r">Arquivos</th>
                <th className="r">Registros</th>
                <th className="r">Tamanho</th>
                <th>Última coleta</th>
              </tr>
            </thead>
            <tbody>
              {datasets.map((d) => (
                <tr key={`${d.source}-${d.dataset}`}>
                  <td>{SOURCE_LABEL[d.source] ?? d.source}</td>
                  <td>{d.dataset.replace(/_/g, " ")}</td>
                  <td className="r">{int(d.files)}</td>
                  <td className="r">{int(d.rows)}</td>
                  <td className="r">{mb(d.bytes)}</td>
                  <td className="num">{dateBr(d.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Coletas mais recentes" subtitle="Cópia exata disponível para download; os arquivos do TSE ficam no próprio TSE">
        <div className="table-wrap -mx-4 sm:-mx-5">
          <table className="data">
            <thead>
              <tr>
                <th>Data</th>
                <th>Fonte / recorte</th>
                <th>SHA-256</th>
                <th className="r">Registros</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((c) => (
                <tr key={c.id}>
                  <td className="num whitespace-nowrap">{dateBr(c.fetched_at)}</td>
                  <td className="min-w-56">
                    {SOURCE_LABEL[c.source] ?? c.source} · {c.dataset.replace(/_/g, " ")} · {c.scope}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                      <a href={c.url.split("#")[0]} className="link" rel="noreferrer">
                        origem
                      </a>
                      {c.r2_key && (
                        <Link to={`/bruto/${c.r2_key}`} reloadDocument className="link">
                          cópia ({mb(c.bytes)})
                        </Link>
                      )}
                    </div>
                  </td>
                  <td>
                    <code className="break-all text-xs text-ink-2">{c.sha256}</code>
                  </td>
                  <td className="r">{int(c.rows)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Últimas execuções da coleta automática">
          <ul className="space-y-2 text-sm">
            {runs.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span aria-hidden style={{ color: r.ok ? "var(--good)" : "var(--critical)" }}>
                  {r.ok ? "✓" : "✕"}
                </span>
                <span>
                  {r.step} <span className="text-ink-3">· {dateBr(r.finished_at)} · {r.ok ? "ok" : "falhou"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Nomes sem vínculo seguro" subtitle="Contas e gabinetes que não foram ligados a um candidato do TSE">
          <ul className="space-y-1 text-sm">
            {unlinked.map((u) => (
              <li key={`${u.source}-${u.alias}`}>
                {u.source === "alesc" ? (
                  <Link className="link" to={`/deputados/gabinete/${encodeURIComponent(u.alias)}`}>
                    {u.alias}
                  </Link>
                ) : (
                  u.alias
                )}{" "}
                <span className="text-xs text-ink-3">{u.source === "alesc" ? "ALESC" : "Câmara"}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Page>
  );
}
