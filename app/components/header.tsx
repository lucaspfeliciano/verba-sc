import { useEffect, useState } from "react";
import { Form, NavLink, useLocation, useNavigation } from "react-router";

import { AnalysisToggle } from "./analysis";

export const NAV = [
  { to: "/governo", label: "Governo", desc: "Executivo estadual" },
  { to: "/deputados", label: "ALESC", desc: "Deputados estaduais" },
  { to: "/congresso", label: "Congresso", desc: "Deputados federais e senadores" },
  { to: "/emendas", label: "Emendas", desc: "Emendas parlamentares federais" },
  { to: "/vereadores", label: "Vereadores", desc: "Câmara de Florianópolis" },
  { to: "/prefeitura", label: "Prefeitura", desc: "Prefeitura de Florianópolis" },
  { to: "/sinais", label: "Sinais", desc: "Coincidências para verificar" },
  { to: "/fontes", label: "Fontes", desc: "De onde vem cada número" },
];

function SearchForm({ className = "", autoFocus = false }: { className?: string; autoFocus?: boolean }) {
  return (
    <Form action="/busca" role="search" className={className}>
      <input
        name="q"
        type="search"
        placeholder="Buscar político, empresa ou CNPJ"
        aria-label="Buscar"
        autoFocus={autoFocus}
        className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
      />
    </Form>
  );
}

export function Header() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigation = useNavigation();

  // Fecha o menu ao navegar e com Esc.
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const loading = navigation.state !== "idle";

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-white"
      >
        Pular para o conteúdo
      </a>
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <NavLink to="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">R$</span>
          Verba SC
        </NavLink>

        <nav aria-label="Principal" className="hidden flex-1 items-center gap-0.5 text-sm lg:flex">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              title={n.desc}
              className={({ isActive }) =>
                `rounded-md px-2.5 py-1.5 ${isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <SearchForm className="hidden w-56 xl:block" />
          <AnalysisToggle className="hidden sm:inline-flex" />
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-md border border-line text-ink-2 hover:text-ink lg:hidden"
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            aria-expanded={open}
            aria-controls="menu-principal"
            onClick={() => setOpen((v) => !v)}
          >
            <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {/* Busca em telas médias, onde o menu inline já cabe mas a busca não. */}
      <div className="mx-auto hidden max-w-6xl px-4 pb-2 sm:px-6 lg:block xl:hidden">
        <SearchForm />
      </div>

      {open && (
        <div id="menu-principal" className="border-t border-line bg-surface lg:hidden">
          <div className="mx-auto max-w-6xl space-y-3 px-4 py-4 sm:px-6">
            <SearchForm />
            <nav aria-label="Principal" className="grid gap-1 sm:grid-cols-2">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2.5 ${isActive ? "bg-surface-2" : "hover:bg-surface-2"}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={`block font-medium ${isActive ? "text-accent-ink" : ""}`}>{n.label}</span>
                      <span className="block text-xs text-ink-3">{n.desc}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
            <AnalysisToggle className="flex w-full justify-center sm:hidden" />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
        {loading && <div className="nav-progress h-full w-1/3 bg-accent" />}
      </div>
    </header>
  );
}
