import { data, redirect } from "react-router";

import { AlescSection } from "~/components/alesc";
import { Page } from "~/components/ui";
import { alescAccountDetail, one } from "~/lib/db.server";
import type { Route } from "./+types/gabinete";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return [{ title: `${data?.account ?? "Gabinete"} — gastos de gabinete na ALESC — Verba SC` }];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const account = params.account;
  // Se a conta já foi ligada a uma pessoa, a ficha completa é o lugar certo.
  const link = await one<{ slug: string }>(
    `SELECT p.slug FROM mandate_link l JOIN politician p ON p.id = l.politician_id WHERE l.source = 'alesc' AND l.alias = ?1`,
    account,
  );
  const url = new URL(request.url);
  if (link) throw redirect(`/pessoa/${link.slug}${url.search}`);
  const year = Number(url.searchParams.get("ano")) || null;
  const detail = await alescAccountDetail([account], year);
  if (!detail) throw data(null, { status: 404 });
  return { account, detail };
}

export default function Gabinete({ loaderData }: Route.ComponentProps) {
  const { account, detail } = loaderData;
  return (
    <Page
      kicker="Gabinete na ALESC"
      title={account}
      intro={
        <p>
          Esta conta da ALESC não foi associada com segurança a um candidato do TSE (nome diferente do de urna, colegiado ou
          liderança). Os gastos estão abaixo, sem os dados de campanha.
        </p>
      }
    >
      <AlescSection d={detail} />
    </Page>
  );
}
