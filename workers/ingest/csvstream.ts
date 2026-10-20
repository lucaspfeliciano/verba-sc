// Leitura de CSV em fluxo: recebe pedaços de texto e emite linhas completas,
// mantendo o estado de aspas entre pedaços. Serve para arquivos grandes demais
// para caber inteiros na memória do Worker (ex.: cota da Câmara, ~75 MB).

import { Unzip, UnzipInflate } from "fflate";

export class CsvStream {
  private row: string[] = [];
  private field = "";
  private quoted = false;
  private pendingQuote = false; // aspas no fim do pedaço: pode ser "" (escape) ou fechamento
  private lastWasCR = false;

  constructor(
    private readonly sep: string,
    private readonly onRow: (row: string[]) => void,
    private readonly quote = '"',
  ) {}

  push(text: string) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.pendingQuote) {
        this.pendingQuote = false;
        if (c === this.quote) {
          this.field += this.quote;
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        if (c === this.quote) {
          if (i + 1 < text.length) {
            if (text[i + 1] === this.quote) {
              this.field += this.quote;
              i++;
            } else this.quoted = false;
          } else this.pendingQuote = true;
        } else this.field += c;
        continue;
      }
      // Aspas só abrem campo no início dele; no meio (ex.: D'AGOSTINI) são texto.
      if (c === this.quote && this.field === "") this.quoted = true;
      else if (c === this.sep) {
        this.row.push(this.field);
        this.field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\n" && this.lastWasCR) {
          this.lastWasCR = false;
          continue;
        }
        this.lastWasCR = c === "\r";
        this.endRow();
        continue;
      } else this.field += c;
      this.lastWasCR = false;
    }
  }

  end() {
    if (this.pendingQuote) this.quoted = false;
    if (this.field !== "" || this.row.length) this.endRow();
  }

  private endRow() {
    this.row.push(this.field);
    this.field = "";
    if (this.row.length > 1 || this.row[0] !== "") this.onRow(this.row);
    this.row = [];
  }
}

/** Latin-1 -> texto. Cada byte é o próprio code point (o runtime não tem decoder latin-1 garantido). */
export function latin1(bytes: Uint8Array): string {
  let out = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]);
  return out;
}

/**
 * Descompacta, em fluxo, os arquivos de um .zip para os quais `pick` devolve um
 * receptor de texto. Os arquivos são entregues na ordem em que estão no zip.
 */
export function unzipEach(zip: Uint8Array, pick: (name: string) => ((text: string) => void) | null, encoding: "utf-8" | "latin1" = "utf-8"): string[] {
  const seen: string[] = [];
  const unzip = new Unzip((file) => {
    const onText = pick(file.name);
    if (!onText) return;
    seen.push(file.name);
    const decoder = encoding === "utf-8" ? new TextDecoder("utf-8") : null;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      onText(decoder ? decoder.decode(chunk, { stream: !final }) : latin1(chunk));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const step = 1 << 20;
  for (let i = 0; i < zip.length; i += step) unzip.push(zip.subarray(i, i + step), i + step >= zip.length);
  return seen;
}

/** Descompacta o primeiro arquivo de um .zip em memória, entregando o texto aos poucos. */
export function unzipFirstFileText(zip: Uint8Array, onText: (text: string) => void): void {
  const decoder = new TextDecoder("utf-8");
  let started = false;
  const unzip = new Unzip((file) => {
    if (started) return;
    started = true;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      onText(decoder.decode(chunk, { stream: !final }));
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  const step = 1 << 20;
  for (let i = 0; i < zip.length; i += step) unzip.push(zip.subarray(i, i + step), i + step >= zip.length);
  if (!started) throw new Error("zip vazio");
}
