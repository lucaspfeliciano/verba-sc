import {
  Form,
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap" },
  {
    rel: "icon",
    href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7' fill='%232a78d6'/><text x='16' y='21' font-size='13' font-family='sans-serif' font-weight='700' text-anchor='middle' fill='white'>R$</text></svg>",
  },
];

const NAV = [
  { to: "/governo", label: "Governo" },
  { to: "/deputados", label: "ALESC" },
  { to: "/congresso", label: "Congresso" },
  { to: "/emendas", label: "Emendas" },
  { to: "/vereadores", label: "Vereadores" },
  { to: "/prefeitura", label: "Prefeitura" },
  { to: "/sinais", label: "Sinais" },
  { to: "/fontes", label: "Fontes" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
            <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-xs font-bold text-white">R$</span>
              Verba SC
            </NavLink>
            <nav className="-mx-1 flex flex-1 flex-wrap gap-1 text-sm">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-md px-2.5 py-1.5 ${isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <Form action="/busca" className="w-full sm:w-64">
              <input
                name="q"
                type="search"
                placeholder="Buscar político, empresa ou CNPJ"
                aria-label="Buscar"
                className="w-full rounded-md border border-line bg-bg px-3 py-1.5 text-sm outline-none placeholder:text-ink-3 focus:border-accent"
              />
            </Form>
          </div>
        </header>
        {children}
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-ink-3 sm:px-6">
            <p>
              Dados públicos da ALESC, da Prefeitura e da Câmara de Florianópolis (portal e-Publica), do PNCP e do TSE. Os
              sinais são indícios para verificação, não acusações.{" "}
              <NavLink to="/sobre" className="link">
                Metodologia e limitações
              </NavLink>
              .
            </p>
            <p>Projeto independente, sem vínculo com os órgãos citados. Inspirado no EloSys.</p>
          </div>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Algo deu errado";
  let details = "Erro inesperado ao montar a página.";
  let stack: string | undefined;
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Página não encontrada" : `Erro ${error.status}`;
    details = error.status === 404 ? "O endereço não existe ou o registro saiu da base." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="mt-2 text-ink-2">{details}</p>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
