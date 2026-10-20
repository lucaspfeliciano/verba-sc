// Modo Análise: com ele ligado, todo dado que tem origem rastreável fica destacado;
// um clique abre a proveniência (arquivo oficial, data da coleta, SHA-256 e cópia exata).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const STORAGE_KEY = "verba-sc:analise";

interface Ctx {
  on: boolean;
  toggle: () => void;
  open: (refs: string[], label?: string) => void;
}
const AnalysisCtx = createContext<Ctx>({ on: false, toggle: () => {}, open: () => {} });
export const useAnalysis = () => useContext(AnalysisCtx);

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  const [dialog, setDialog] = useState<{ refs: string[]; label?: string } | null>(null);
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setOn(true);
    } catch {
      /* armazenamento indisponível: começa desligado */
    }
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-analise", on);
  }, [on]);
  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
      } catch {
        /* sem persistência */
      }
      return !v;
    });
  }, []);
  const open = useCallback((refs: string[], label?: string) => setDialog({ refs, label }), []);
  return (
    <AnalysisCtx.Provider value={{ on, toggle, open }}>
      {children}
      {dialog && <ProvenanceDialog refs={dialog.refs} label={dialog.label} onClose={() => setDialog(null)} />}
    </AnalysisCtx.Provider>
  );
}

export function AnalysisToggle({ className = "" }: { className?: string }) {
  const { on, toggle } = useAnalysis();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      title="Modo Análise: destaca os dados com origem rastreável; clique num dado para ver o arquivo oficial de onde ele veio"
      className={`items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
        on ? "border-[var(--good)] bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-ink" : "border-line text-ink-2 hover:text-ink"
      } ${className}`}
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
        <path d="M11 8v6M8 11h6" />
      </svg>
      Modo Análise
      <span className="sr-only">{on ? " (ligado)" : " (desligado)"}</span>
    </button>
  );
}

type Tag = "div" | "span" | "tr" | "li";

/**
 * Envolve um dado exibido. `refs` aponta para as coletas de origem
 * ("d:fonte/conjunto/recorte" ou "c:<id>"). Sem Modo Análise, não muda nada.
 */
export function Src({
  refs,
  as,
  label,
  className,
  children,
}: {
  refs: (string | null | undefined)[] | string | null | undefined;
  as?: Tag;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const { on, open } = useAnalysis();
  const list = [refs].flat().filter((r): r is string => !!r);
  const T = as ?? "div";
  if (!on || list.length === 0) {
    return as || className ? <T className={className}>{children}</T> : <>{children}</>;
  }
  return (
    <T
      className={`src-zone ${className ?? ""}`}
      tabIndex={0}
      role="button"
      aria-label={`Ver a origem deste dado${label ? `: ${label}` : ""}`}
      onClickCapture={(e) => {
        e.preventDefault();
        e.stopPropagation();
        open(list, label);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(list, label);
        }
      }}
    >
      {children}
    </T>
  );
}

interface Item {
  id: number;
  source: string;
  dataset: string;
  scope: string;
  url: string;
  fetched_at: string;
  http_status: number | null;
  bytes: number | null;
  sha256: string;
  rows: number | null;
  source_name: string;
  agency: string | null;
  home: string | null;
  legal: string | null;
  dataset_label: string;
  download: string | null;
}

function ProvenanceDialog({ refs, label, onClose }: { refs: string[]; label?: string; onClose: () => void }) {
  const [data, setData] = useState<{ items: Item[]; totals: Record<string, number> } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const qs = new URLSearchParams();
    for (const r of refs) qs.append("ref", r);
    fetch(`/api/proveniencia?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setData(d as { items: Item[]; totals: Record<string, number> }))
      .catch(() => setError(true));
  }, [refs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const groups = new Map<string, Item[]>();
  for (const it of data?.items ?? []) {
    const k = `${it.source}/${it.dataset}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Origem do dado"
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface p-5 shadow-xl sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Origem do dado</p>
            {label && <p className="mt-0.5 font-semibold">{label}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
            ✕
          </button>
        </div>

        {!data && !error && <p className="mt-6 text-sm text-ink-3">Buscando a coleta…</p>}
        {error && <p className="mt-6 text-sm text-ink-2">Não foi possível carregar a origem agora.</p>}
        {data && data.items.length === 0 && <p className="mt-6 text-sm text-ink-2">Nenhuma coleta registrada para este dado.</p>}

        <div className="mt-4 space-y-5">
          {[...groups.values()].map((items) => {
            const first = items[0];
            return (
              <section key={`${first.source}/${first.dataset}`} className="rounded-xl border border-line p-4">
                <p className="font-semibold">{first.source_name}</p>
                <p className="text-sm text-ink-2">
                  {first.dataset_label}
                  {first.agency ? ` · ${first.agency}` : ""}
                </p>
                {first.legal && <p className="mt-1 text-xs text-ink-3">Base legal: {first.legal}</p>}
                <ul className="mt-3 divide-y divide-line">
                  {items.slice(0, 6).map((it) => (
                    <li key={it.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="font-medium">Recorte {it.scope}</span>
                        <span className="text-xs text-ink-3">
                          coletado em {new Date(it.fetched_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          {it.rows !== null ? ` · ${it.rows.toLocaleString("pt-BR")} registros` : ""}
                          {it.bytes ? ` · ${(it.bytes / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : ""}
                        </span>
                      </div>
                      <a href={it.url.split("#")[0]} target="_blank" rel="noreferrer" className="link mt-1 block break-all text-xs">
                        {it.url}
                      </a>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                        <code className="break-all">SHA-256 {it.sha256}</code>
                        {it.download && (
                          <a href={it.download} className="link" download>
                            Baixar a cópia exata
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                {items.length > 6 && <p className="mt-2 text-xs text-ink-3">e mais {items.length - 6} arquivo(s) deste conjunto.</p>}
              </section>
            );
          })}
        </div>

        {data && data.items.length > 0 && (
          <p className="mt-5 text-xs text-ink-3">
            Para conferir: baixe o arquivo na fonte (ou a cópia exata) e calcule o SHA-256, por exemplo com{" "}
            <code>sha256sum arquivo</code> ou <code>Get-FileHash arquivo</code>. Se o valor bater, o dado veio desse arquivo sem
            alteração.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
