import { Link } from "react-router";

import { Card, Page } from "~/components/ui";

export function meta() {
  return [{ title: "Metodologia e limitações — Verba SC" }];
}

export default function Sobre() {
  return (
    <Page
      kicker="Sobre o projeto"
      title="Metodologia e limitações"
      intro={
        <p>
          O Verba SC reúne dados públicos sobre como deputados federais, senadores e deputados estaduais de Santa Catarina,
          vereadores e a Prefeitura de Florianópolis usam recursos públicos, e cruza esses gastos com as contas de campanha declaradas ao TSE.
        </p>
      }
    >
      <Card title="O que está aqui">
        <ul className="list-disc space-y-2 pl-5 text-ink-2">
          <li>
            <strong className="text-ink">Governo de SC (Poder Executivo):</strong> empenhos por órgão e credor desde 2021 e
            contratos, do Portal de Dados Abertos de SC. Gabinete do Governador, Vice-Governadoria e Comunicação aparecem
            empenho a empenho. Os valores são de empenho (compromisso de gasto), líquidos de anulações e estornos.
          </li>
          <li>
            <strong className="text-ink">Câmara dos Deputados e Senado:</strong> cota para o exercício da atividade
            parlamentar (CEAP e CEAPS) dos deputados federais e senadores de SC desde 2015, com CNPJ do fornecedor e, na Câmara,
            o link para a nota fiscal. Os arquivos cobrem o país inteiro: guardamos os lançamentos de SC e, de todos, a mediana
            por categoria, para comparação. Deputados federais são ligados ao TSE pelo CPF publicado pela Câmara.
          </li>
          <li>
            <strong className="text-ink">Emendas parlamentares (Portal da Transparência, CGU):</strong> emendas de autoria
            dos deputados federais e senadores de SC e da bancada catarinense, com destino, favorecidos (CNPJ/CPF) e convênios.
            O autor é identificado pelo nome parlamentar.
          </li>
          <li>
            <strong className="text-ink">ALESC:</strong> despesas dos gabinetes parlamentares desde 2011 (diárias, passagens,
            telefone, veículos, aluguel, gráfica, reembolsos). Não inclui salários.
          </li>
          <li>
            <strong className="text-ink">ALESC, pagamentos a credores:</strong> quem a Assembleia pagou de fato, com CPF/CNPJ,
            desde 2011. É o que mostra, por exemplo, que a verba de correspondência vai para os Correios e que a indenização de
            veículos é paga ao próprio deputado. Folha de pessoal, diárias de servidores e ressarcimentos médicos não são
            coletados.
          </li>
          <li>
            <strong className="text-ink">Câmara de Florianópolis:</strong> cargos comissionados com lotação e vencimento bruto
            (foto mensal) e pagamentos por favorecido.
          </li>
          <li>
            <strong className="text-ink">Prefeitura de Florianópolis:</strong> pagamentos por favorecido (somando fundos,
            fundações e autarquias), diárias e contratos publicados no PNCP.
          </li>
          <li>
            <strong className="text-ink">TSE:</strong> candidaturas a deputado estadual e federal, senador e suplentes,
            governador e vice por SC (2010–2026) e a prefeito, vice e
            vereador de Florianópolis (2016–2024), receitas e despesas de campanha (a partir de 2018) e bens declarados.
          </li>
        </ul>
      </Card>

      <Card title="Como as pessoas são identificadas">
        <div className="space-y-2 text-ink-2">
          <p>
            Uma pessoa é identificada pelo título de eleitor publicado pelo TSE, o que junta as candidaturas de anos diferentes.
            As fontes de mandato não trazem documento: a ALESC usa o nome do gabinete e a Câmara, a lotação. Esses nomes são
            ligados ao candidato eleito ou suplente com o mesmo nome (de urna ou completo), preferindo quem tinha mandato no
            período. Quando há empate, nada é ligado, e o nome aparece em{" "}
            <Link to="/fontes" className="link">
              Fontes
            </Link>{" "}
            como sem vínculo.
          </p>
          <p>CPFs nunca são exibidos. Eles só servem, internamente, para cruzar registros.</p>
        </div>
      </Card>

      <Card title="Limitações conhecidas">
        <ul className="list-disc space-y-2 pl-5 text-ink-2">
          <li>
            O CSV de gabinetes da ALESC traz só o nome do favorecido. O CNPJ é recuperado quando o mesmo nome aparece, com um
            único CNPJ, nos pagamentos a credores; nos demais casos o cruzamento é por nome e pode errar.
          </li>
          <li>
            Só a partir de 2024 a ALESC separa, nos pagamentos, as despesas dos gabinetes das demais compras da Casa e indica o
            deputado de referência. Antes disso, os credores de uma natureza de despesa incluem outras compras da Assembleia.
          </li>
          <li>
            Os valores da Prefeitura e da Câmara são de empenhos <em>emitidos</em> no ano. Pagamentos de restos a pagar de anos
            anteriores não entram no total do ano.
          </li>
          <li>
            No PNCP, os contratos publicados com o CNPJ da Prefeitura começam em 2025; a cobertura é parcial. O retrato mais
            completo dos pagamentos é o do portal e-Publica.
          </li>
          <li>O portal e-Publica não tem API documentada. Se o formato mudar, a coleta pode falhar até ser ajustada.</li>
          <li>Os dados de campanha de 2026 ainda estão sendo entregues pelos candidatos e mudam até a prestação final.</li>
        </ul>
      </Card>

      <Card title="Indício não é prova">
        <p className="text-ink-2">
          Os sinais apontam coincidências estatísticas ou cadastrais. Uma empresa que trabalhou numa campanha pode vencer uma
          licitação legitimamente, e um gabinete pode gastar mais com passagens por representar uma região distante. Use os
          sinais para fazer perguntas e checar documentos, nunca como conclusão. Para denúncias, procure o Ministério Público
          de SC, o Tribunal de Contas do Estado ou a Ouvidoria do órgão.
        </p>
      </Card>

      <Card title="Créditos">
        <p className="text-ink-2">
          A ideia de cruzar dados públicos por documento, com proveniência por arquivo, vem do projeto EloSys. O código do Verba
          SC é independente. Infraestrutura: Cloudflare Workers, D1, R2 e Workflows.
        </p>
      </Card>
    </Page>
  );
}
