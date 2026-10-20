import { Link } from "react-router";

import type { SignalRow } from "~/lib/db.server";
import { docLabel, isCnpj } from "~/lib/format";
import { SeverityBadge } from "./ui";

export const RULE_LABEL: Record<string, string> = {
  campanha_depois_contrato: "Campanha → contrato",
  gabinete_fornecedor_campanha: "Gabinete e campanha",
  gabinete_gasto_atipico: "Gasto atípico",
  cota_fornecedor_campanha: "Cota e campanha",
  cota_gasto_atipico: "Cota atípica",
  emenda_campanha: "Emenda e campanha",
  estado_campanha_contrato: "Governo: campanha → empenhos",
  ciclo_dinheiro: "Ciclo de dinheiro",
};

export const RULE_HELP: Record<string, string> = {
  campanha_depois_contrato:
    "Empresa que prestou serviço ou doou para a campanha de um eleito em Florianópolis e, no mandato seguinte, recebeu pagamentos da Prefeitura ou da Câmara (ligação por CNPJ). A severidade compara a média anual recebida antes e depois da eleição: empresa que só passou a receber depois pesa mais; fornecedor que já recebia no mesmo patamar fica com severidade baixa. Bancos, concessionárias e fornecedores de mais de 5 campanhas ficam de fora.",
  gabinete_fornecedor_campanha:
    "Favorecido da verba de gabinete da ALESC com o mesmo nome de um fornecedor da campanha do mesmo deputado. Ligação por nome: a ALESC não publica CNPJ.",
  gabinete_gasto_atipico:
    "Gasto anual de um gabinete da ALESC numa categoria pelo menos 3 vezes acima da mediana dos colegas no mesmo ano.",
  cota_fornecedor_campanha:
    "Fornecedor pago pela cota parlamentar de um deputado federal ou senador de SC que também prestou serviço à campanha do mesmo parlamentar. Ligação por CNPJ. Companhias aéreas, operadoras e fornecedores de mais de 5 campanhas ficam de fora.",
  cota_gasto_atipico:
    "Gasto anual de um deputado federal ou senador de SC numa categoria da cota pelo menos 3 vezes acima da mediana de todos os parlamentares do país que usaram a categoria, e acima de 90% deles.",
  emenda_campanha:
    "Empresa, entidade ou pessoa que recebeu dinheiro de emenda parlamentar de um deputado federal ou senador de SC e que também doou para a campanha dele ou prestou serviço a ela. Ligação por CNPJ/CPF.",
  estado_campanha_contrato:
    "Quem prestou serviço ou doou para a campanha do governador ou do vice eleitos e, no mandato seguinte, recebeu empenhos do Governo de SC (ligação por CNPJ/CPF). Compara a média anual antes e depois da eleição quando há dados (os empenhos do Estado começam em 2021).",
  ciclo_dinheiro:
    "Dinheiro que sai de alguém e volta para a mesma pessoa passando por até 5 participantes (doações, pagamentos de campanha, cota parlamentar, emendas e verba de gabinete). Detectado com o algoritmo de Tarjan; ciclos acima de R$ 10 mil. Veja a página Ciclos.",
};

export function SignalList({ rows, showPerson = true }: { rows: SignalRow[]; showPerson?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-ink-3">Nenhum sinal.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((s) => (
        <li key={s.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={s.severity} />
            <span className="text-xs text-ink-3">{RULE_LABEL[s.rule] ?? s.rule}</span>
          </div>
          <Link to={`/sinais/${s.key}`} className="mt-1 block font-medium hover:text-accent-ink hover:underline">
            {s.title}
          </Link>
          <p className="mt-0.5 text-sm text-ink-2">{s.detail}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link to={`/sinais/${s.key}`} className="link font-medium">
              Entender o caso →
            </Link>
            {showPerson && s.slug && (
              <Link to={`/pessoa/${s.slug}`} className="link">
                {s.ballot_name}
              </Link>
            )}
            {isCnpj(s.doc) && (
              <Link to={`/fornecedor/${s.doc}`} className="link">
                CNPJ {docLabel(s.doc)}
              </Link>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
