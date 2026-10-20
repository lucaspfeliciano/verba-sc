import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("deputados", "routes/deputados.tsx"),
  route("deputados/gabinete/:account", "routes/gabinete.tsx"),
  route("governo", "routes/governo.tsx"),
  route("congresso", "routes/congresso.tsx"),
  route("emendas", "routes/emendas.tsx"),
  route("vereadores", "routes/vereadores.tsx"),
  route("prefeitura", "routes/prefeitura.tsx"),
  route("pessoa/:slug", "routes/pessoa.tsx"),
  route("fornecedor/:doc", "routes/fornecedor.tsx"),
  route("ciclos", "routes/ciclos.tsx"),
  route("sinais", "routes/sinais.tsx"),
  route("sinais/:key", "routes/sinal.tsx"),
  route("busca", "routes/busca.tsx"),
  route("fontes", "routes/fontes.tsx"),
  route("sobre", "routes/sobre.tsx"),
  route("api/proveniencia", "routes/api.proveniencia.ts"),
] satisfies RouteConfig;
