// Catálogo das fontes oficiais, usado pelo Modo Análise para explicar de onde vem cada dado.

export interface SourceMeta {
  name: string;
  agency: string;
  home: string;
  legal: string;
  datasets: Record<string, string>;
}

export const SOURCES: Record<string, SourceMeta> = {
  alesc: {
    name: "Portal da Transparência da ALESC",
    agency: "Assembleia Legislativa de Santa Catarina",
    home: "https://transparencia.alesc.sc.gov.br/",
    legal: "Lei de Acesso à Informação (Lei 12.527/2011), transparência ativa.",
    datasets: {
      gabinetes: "Despesas dos gabinetes parlamentares (CSV anual)",
      pagamentos: "Pagamentos a credores (CSV anual)",
    },
  },
  epublica_pmf: {
    name: "Portal da Transparência de Florianópolis (e-Publica)",
    agency: "Prefeitura Municipal de Florianópolis",
    home: "https://www.pmf.sc.gov.br/transparencia/",
    legal: "Lei Complementar 131/2009 e Lei 12.527/2011.",
    datasets: {
      gastos_favorecido: "Gastos por favorecido (API do portal, por página)",
      diarias: "Diárias (API do portal, por página)",
    },
  },
  epublica_cmf: {
    name: "Portal da Transparência da Câmara de Florianópolis (e-Publica)",
    agency: "Câmara Municipal de Florianópolis",
    home: "https://transparencia.e-publica.net/epublica-portal/#/florianopolis/portal?entidade=1018",
    legal: "Lei Complementar 131/2009 e Lei 12.527/2011.",
    datasets: {
      gastos_favorecido: "Gastos por favorecido (API do portal, por página)",
      comissionados: "Cargos comissionados (API do portal, por página)",
    },
  },
  pncp: {
    name: "Portal Nacional de Contratações Públicas (PNCP)",
    agency: "Ministério da Gestão e da Inovação",
    home: "https://pncp.gov.br/",
    legal: "Lei 14.133/2021, art. 174.",
    datasets: { contratos: "Contratos por órgão (API de consulta)" },
  },
  tse: {
    name: "Portal de Dados Abertos do TSE",
    agency: "Tribunal Superior Eleitoral",
    home: "https://dadosabertos.tse.jus.br/",
    legal: "Lei 9.504/1997 (prestação de contas eleitorais) e resoluções do TSE.",
    datasets: {
      candidaturas: "Candidaturas (consulta_cand)",
      bens: "Bens declarados (bem_candidato)",
      receitas: "Receitas de campanha (prestação de contas)",
      despesas_contratadas: "Despesas contratadas de campanha (prestação de contas)",
    },
  },
  camara: {
    name: "Dados Abertos da Câmara dos Deputados",
    agency: "Câmara dos Deputados",
    home: "https://www.camara.leg.br/transparencia/gastos-parlamentares",
    legal: "Ato da Mesa 43/2009 (CEAP) e Lei 12.527/2011.",
    datasets: { ceap: "Cota para o Exercício da Atividade Parlamentar (arquivo anual nacional)" },
  },
  senado: {
    name: "Dados Abertos do Senado Federal",
    agency: "Senado Federal",
    home: "https://www12.senado.leg.br/transparencia",
    legal: "Ato da Comissão Diretora 3/2003 (CEAPS) e Lei 12.527/2011.",
    datasets: { ceaps: "Cota parlamentar dos senadores (API anual)", senadores: "Senadores por legislatura" },
  },
  cgu: {
    name: "Portal da Transparência do Governo Federal",
    agency: "Controladoria-Geral da União",
    home: "https://portaldatransparencia.gov.br/emendas",
    legal: "Constituição, art. 166; Lei 12.527/2011.",
    datasets: { emendas: "Emendas parlamentares (arquivo único com todo o histórico)" },
  },
  estado: {
    name: "Portal de Dados Abertos de Santa Catarina",
    agency: "Secretaria de Estado da Fazenda de SC",
    home: "https://dados.sc.gov.br/",
    legal: "Lei Complementar 131/2009 e Lei 12.527/2011.",
    datasets: { empenhos: "Empenhos do Poder Executivo (CSV anual)", contratos: "Contratos do Poder Executivo (CSV)" },
  },
};

/** Referência a um conjunto coletado: "d:fonte/conjunto/recorte" (recorte é prefixo) ou "c:<id da coleta>". */
export const ds = (source: string, dataset: string, scope?: string | number) =>
  `d:${source}/${dataset}${scope !== undefined && scope !== null ? `/${scope}` : ""}`;
export const col = (id: number | null | undefined) => (id ? `c:${id}` : null);

/** Recortes das fontes em que cada ano é um arquivo à parte. */
export const src = {
  alesc: (y: number) => ds("alesc", "gabinetes", y),
  alescPay: (y: number) => ds("alesc", "pagamentos", y),
  pmf: (y: number) => ds("epublica_pmf", "gastos_favorecido", `${y}-`),
  pmfDiarias: (y: number) => ds("epublica_pmf", "diarias", `${y}-`),
  cmf: (y: number) => ds("epublica_cmf", "gastos_favorecido", `${y}-`),
  cmfStaff: () => ds("epublica_cmf", "comissionados"),
  pncp: (y?: number) => ds("pncp", "contratos", y ? `82892282000143-${y}` : undefined),
  tseCand: (y: number) => ds("tse", "candidaturas", y),
  tseMoney: (y: number) => [ds("tse", "receitas", y), ds("tse", "despesas_contratadas", y)],
  tseAssets: (y: number) => ds("tse", "bens", y),
  camara: (y: number) => ds("camara", "ceap", y),
  senado: (y: number) => ds("senado", "ceaps", y),
  fed: (house: string, y: number) => ds(house, house === "camara" ? "ceap" : "ceaps", y),
  emendas: () => ds("cgu", "emendas"),
  estado: (y: number) => ds("estado", "empenhos", y),
  estadoContratos: () => ds("estado", "contratos"),
};
