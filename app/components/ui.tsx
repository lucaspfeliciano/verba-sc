import type { ReactNode } from "react";
import { Link } from "react-router";

import { brl, brlCompact } from "~/lib/format";

export function Page({ title, kicker, intro, children }: { title: string; kicker?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {kicker && <p className="text-sm font-medium text-accent-ink">{kicker}</p>}
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {intro && <div className="mt-3 max-w-3xl text-ink-2">{intro}</div>}
      <div className="mt-8 space-y-8">{children}</div>
    </main>
  );
}

export function Card({ title, subtitle, children, action }: { title?: ReactNode; subtitle?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      {(title || action) && (
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{label}</p>
      <p className="num mt-1 text-xl font-semibold sm:text-2xl">{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>;
}

/**
 * Barras horizontais de uma única série (magnitude). O valor fica em texto ao
 * lado de cada barra, então a cor nunca carrega informação sozinha.
 */
export function BarList({
  items,
  max,
  empty = "Sem dados para o recorte.",
}: {
  items: { key: string; label: ReactNode; cents: number; href?: string; note?: ReactNode }[];
  max?: number;
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-ink-3">{empty}</p>;
  const top = max ?? Math.max(...items.map((i) => i.cents), 1);
  return (
    <ol className="space-y-2.5">
      {items.map((i) => {
        const pct = Math.max(0.6, (i.cents / top) * 100);
        const label = i.href ? (
          <Link to={i.href} className="link">
            {i.label}
          </Link>
        ) : (
          i.label
        );
        return (
          <li key={i.key} className="group" title={`${typeof i.label === "string" ? i.label : ""} — ${brl(i.cents)}`}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{label}</span>
              <span className="num shrink-0 font-medium">{brlCompact(i.cents)}</span>
            </div>
            {i.note && <div className="text-xs text-ink-3">{i.note}</div>}
            <div className="mt-1 h-2 rounded-full" style={{ background: "var(--bar-track)" }}>
              <div
                className="h-2 rounded-full transition-opacity group-hover:opacity-80"
                style={{ width: `${pct}%`, background: "var(--bar)" }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Colunas por período (ex.: mês ou ano), série única, com tooltip nativo por coluna. */
export function Columns({ items, height = 140 }: { items: { key: string; label: string; cents: number }[]; height?: number }) {
  if (items.length === 0) return <p className="text-sm text-ink-3">Sem dados.</p>;
  const top = Math.max(...items.map((i) => i.cents), 1);
  return (
    <div>
      <div className="flex items-end gap-[2px]" style={{ height }} role="img" aria-label="Gráfico de colunas; os valores estão na tabela abaixo">
        {items.map((i) => (
          <div key={i.key} className="group relative flex h-full flex-1 items-end" title={`${i.label}: ${brl(i.cents)}`}>
            <div
              className="w-full rounded-t-[4px] group-hover:opacity-80"
              style={{ height: `${Math.max(1, (i.cents / top) * 100)}%`, background: "var(--bar)" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-ink-3">
        {items.map((i, idx) => (
          <div key={i.key} className="flex-1 text-center">
            {items.length <= 16 || idx % Math.ceil(items.length / 12) === 0 ? i.label : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

const SEVERITY = {
  high: { label: "Alta", color: "var(--critical)", icon: "▲" },
  medium: { label: "Média", color: "var(--serious)", icon: "◆" },
  low: { label: "Baixa", color: "var(--warning)", icon: "●" },
} as const;

export function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY[severity as keyof typeof SEVERITY] ?? SEVERITY.low;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-xs font-medium text-ink-2">
      <span aria-hidden style={{ color: s.color }}>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">{children}</span>;
}

export function YearTabs({ years, current, param = "ano" }: { years: number[]; current: number; param?: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label="Ano">
      {years.map((y) => (
        <Link
          key={y}
          to={`?${param}=${y}`}
          preventScrollReset
          className={`num rounded-md border px-2.5 py-1 text-sm ${
            y === current ? "border-accent bg-accent text-white" : "border-line bg-surface text-ink-2 hover:border-ink-3"
          }`}
        >
          {y}
        </Link>
      ))}
    </nav>
  );
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return (
    <p className="rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm text-ink-2">
      {children ?? (
        <>
          Sinais são <strong>indícios para verificação</strong>, não provas nem acusações. Coincidências podem ter explicação
          legítima. Cada número aponta para o arquivo oficial de onde veio.
        </>
      )}
    </p>
  );
}

export function SourceNote({ children }: { children: ReactNode }) {
  return <p className="text-xs text-ink-3">Fonte: {children}</p>;
}
