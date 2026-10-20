// Liga as verbas do CSV de gabinetes da ALESC às naturezas de despesa dos
// pagamentos a credores, para mostrar quem recebe o dinheiro de fato.
// Códigos conferidos nos arquivos de 2013, 2019 e 2025 (naturezas estáveis).

export const GABINETE_SUBACAO = "15915"; // atividade parlamentar, separada a partir de 2024

export const CATEGORY_NATUREZAS: Record<string, string[]> = {
  "CORRESPONDÊNCIA / TELEGRAMA": ["33903947"],
  TELEFONE: ["33904097", "33903958"],
  PASSAGENS: ["33903301", "33903307", "33903308"],
  "VEÍCULOS": ["33909310", "33903304"],
  "COMBUSTÍVEIS": ["33903001"],
  ALUGUEL: ["33903615", "33903910", "33903903"],
  REEMBOLSOS: ["33909302"],
  "ASSINATURA DE TV A CABO": ["33903901"],
  ALMOXARIFADO: ["33903901", "33903016", "33903017"],
  "INSCRIÇÃO": ["33903931"],
  "GRÁFICA": ["33903963"],
};

export const CATEGORY_HOW: Record<string, string> = {
  "CORRESPONDÊNCIA / TELEGRAMA":
    "A ALESC tem uma conta única com os Correios e paga uma fatura por mês. O valor de cada gabinete é a parte dele nessa fatura.",
  TELEFONE: "Pago pela ALESC às operadoras contratadas (linhas e dados dos gabinetes).",
  PASSAGENS: "Compradas pela ALESC por meio de agências de turismo contratadas.",
  "VEÍCULOS": "Indenização ao próprio deputado pelo uso de veículo particular, ou locação por empresa contratada pela ALESC.",
  "COMBUSTÍVEIS": "Pago à empresa que administra o cartão de abastecimento dos gabinetes.",
  ALUGUEL: "Aluguel do escritório de apoio do deputado, pago diretamente ao proprietário (pessoa ou imobiliária).",
  REEMBOLSOS:
    "O gabinete paga o fornecedor e a ALESC devolve o valor ao deputado. Por isso, nos pagamentos da ALESC o credor é o próprio deputado; o fornecedor real aparece no CSV de gabinetes.",
  "ASSINATURA DE TV A CABO": "Assinaturas contratadas pela ALESC.",
  ALMOXARIFADO: "Jornais, revistas e material de expediente fornecidos pela ALESC aos gabinetes.",
  "INSCRIÇÃO": "Inscrições em cursos e eventos pagas aos organizadores.",
  "DIÁRIAS": "Pagas diretamente ao deputado ou ao servidor que viajou.",
};

export type RecipientKind = "publica" | "empresa" | "pessoa" | "gabinete";

export const KIND_LABEL: Record<RecipientKind, string> = {
  publica: "Empresa ou órgão público",
  empresa: "Empresa privada",
  pessoa: "Pessoa física",
  gabinete: "Pago ao próprio deputado",
};

// Raízes de CNPJ: Correios, Banco do Brasil, Caixa, Celesc.
const PUBLIC_ROOTS = new Set(["34028316", "00000000", "00360305", "08336783"]);
const PUBLIC_NAME = /CORREIOS|CAIXA ECONOMICA|BANCO DO BRASIL|ASSEMBLEIA LEGISLATIVA|CELESC|CASAN|ESTADO DE SANTA CATARINA|MUNICIPIO|SECRETARIA/;

export function recipientKind(r: { doc: string | null; doc_fmt: string | null; credor_norm: string; natureza: string }): RecipientKind {
  if (r.natureza === "33909302" || r.natureza === "33909310") return "gabinete";
  if ((r.doc && PUBLIC_ROOTS.has(r.doc.slice(0, 8))) || PUBLIC_NAME.test(r.credor_norm)) return "publica";
  if (!r.doc) return "pessoa";
  return "empresa";
}

export function categoryForNatureza(natureza: string): string | null {
  for (const [cat, ns] of Object.entries(CATEGORY_NATUREZAS)) if (ns.includes(natureza)) return cat;
  return null;
}
