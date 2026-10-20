const brlFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlShortFmt = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat("pt-BR");

export const brl = (cents: number | null | undefined) => brlFmt.format((cents ?? 0) / 100);
export const brl0 = (cents: number | null | undefined) => brlShortFmt.format((cents ?? 0) / 100);
export const int = (n: number | null | undefined) => intFmt.format(n ?? 0);

/** Valor compacto: R$ 1,2 mi / R$ 350 mil. */
export function brlCompact(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100;
  const a = Math.abs(v);
  if (a >= 1e9) return `R$ ${(v / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} bi`;
  if (a >= 1e6) return `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 1e4) return `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return brlShortFmt.format(v);
}

export function dateBr(iso: string | null | undefined): string {
  if (!iso) return "–";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** CNPJ formatado; CPF sempre mascarado (o site nunca exibe CPF inteiro). */
export function docLabel(doc: string | null | undefined): string {
  if (!doc) return "";
  if (doc.startsWith("NOME:")) return "sem documento";
  if (doc.length === 14) return doc.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (doc.length === 11) return `***.${doc.slice(3, 6)}.${doc.slice(6, 9)}-**`;
  return "documento mascarado";
}

export const isCnpj = (doc: string | null | undefined) => !!doc && doc.length === 14;

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  const small = new Set(["da", "de", "do", "das", "dos", "e"]);
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Categorias da Câmara/Senado vêm em maiúsculas e com ponto final. */
export function fedCategory(c: string | null | undefined): string {
  if (!c) return "";
  const s = c.toLowerCase().replace(/\s+,/g, ",").replace(/,(?=\S)/g, ", ").replace(/[.\s]+$/, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const HOUSE_LABEL: Record<string, string> = { camara: "Câmara dos Deputados", senado: "Senado Federal" };

export const OFFICE_LABEL: Record<string, string> = {
  "DEPUTADO ESTADUAL": "Deputado(a) estadual",
  "DEPUTADO FEDERAL": "Deputado(a) federal",
  SENADOR: "Senador(a)",
  "1º SUPLENTE": "1º suplente de senador",
  "2º SUPLENTE": "2º suplente de senador",
  GOVERNADOR: "Governador(a)",
  "VICE-GOVERNADOR": "Vice-governador(a)",
  VEREADOR: "Vereador(a)",
  PREFEITO: "Prefeito(a)",
  "VICE-PREFEITO": "Vice-prefeito(a)",
};

/** "Gabinete 06 (Edinon Manoel da Rosa)" -> "Edinon Manoel da Rosa". */
export const officeLabel = (office: string) =>
  office.replace(/^Gabinete\s+/, "").replace(/^\d+\s*\((.*)\)$/, "$1");

export const gabineteHref = (account: string, slug: string | null) =>
  slug ? `/pessoa/${slug}` : `/deputados/gabinete/${encodeURIComponent(account)}`;

export const ENTITY_LABEL: Record<number, string> = { 2002: "Prefeitura", 1018: "Câmara Municipal" };
