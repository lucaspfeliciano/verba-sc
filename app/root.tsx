import {
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { AnalysisProvider } from "./components/analysis";
import { Header } from "./components/header";
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


export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:site_name" content="Verba SC" />
        <meta property="og:type" content="website" />
        <meta property="og:locale" content="pt_BR" />
        <meta name="theme-color" content="#2a78d6" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen font-sans antialiased">
        <AnalysisProvider>
          <Header />
          {children}
        </AnalysisProvider>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl space-y-2 px-4 py-6 text-sm text-ink-3 sm:px-6">
            <p>
              Dados públicos do Governo de SC, da ALESC, da Câmara dos Deputados, do Senado, do Portal da Transparência (CGU),
              da Prefeitura e da Câmara de Florianópolis, do PNCP e do TSE. Os sinais são indícios para verificação, não
              acusações.{" "}
              <NavLink to="/sobre" className="link">
                Metodologia e limitações
              </NavLink>{" "}
              ·{" "}
              <a className="link" href="https://github.com/lucaspfeliciano/verba-sc" rel="noreferrer">
                Código-fonte
              </a>
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
      <p className="mt-6 flex flex-wrap gap-4 text-sm">
        <NavLink to="/" className="link">
          Ir para o início
        </NavLink>
        <NavLink to="/busca" className="link">
          Buscar político ou empresa
        </NavLink>
      </p>
      {stack && (
        <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
