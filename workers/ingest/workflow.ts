// Orquestração da ingestão com Cloudflare Workflows. Cada coleta é uma etapa
// independente, com novas tentativas; falhas de uma fonte não derrubam as demais.

import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

import { ALESC_FIRST_YEAR, ingestAlescYear } from "./alesc";
import { ingestAlescPaymentsYear } from "./alesc_payments";
import { computeSignals, relinkMandates } from "./derive";
import { ingestEmendas } from "./emendas";
import { ESTADO_FIRST_YEAR, ingestEstadoContratos, ingestEstadoEmpenhosYear } from "./estado";
import { CAMARA_FIRST_YEAR, SENADO_FIRST_YEAR, ingestCamaraYear, ingestSenadoYear } from "./federal";
import { ENTITY_CMF, ENTITY_PMF, ingestPayeesYear, ingestPerDiemYear, ingestStaffSnapshot } from "./epublica";
import { PMF_CNPJ, ingestPncpYear } from "./pncp";
import { nowIso } from "./util";

export interface IngestParams {
  /** Coleta o histórico inteiro em vez de só os anos recentes. */
  backfill?: boolean;
  /** Restringe a execução a estas fontes. */
  only?: ("alesc" | "pmf" | "cmf" | "pncp" | "camara" | "senado" | "emendas" | "estado" | "derive")[];
  years?: number[];
}

export const EPUBLICA_FIRST_YEAR = 2017;
export const PNCP_FIRST_YEAR = 2021;

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: Readonly<WorkflowEvent<IngestParams>>, step: WorkflowStep) {
    const p = event.payload ?? {};
    const now = new Date();
    const year = now.getUTCFullYear();
    // Nos primeiros meses do ano o exercício anterior ainda recebe lançamentos.
    const recent = now.getUTCMonth() < 3 ? [year - 1, year] : [year];
    const want = (s: NonNullable<IngestParams["only"]>[number]) => !p.only || p.only.includes(s);
    const years = (first: number) => p.years ?? (p.backfill ? range(first, year) : recent);

    const cfg = { retries: { limit: 3, delay: "1 minute" as const, backoff: "exponential" as const }, timeout: "15 minutes" as const };
    const results: Record<string, unknown> = {};
    const run = async (name: string, fn: () => Promise<unknown>) => {
      try {
        results[name] = await step.do(name, cfg, async () => {
          const started = nowIso();
          try {
            const out = await fn();
            await this.log(event.instanceId, name, started, true, out);
            return out as any;
          } catch (err) {
            await this.log(event.instanceId, name, started, false, String(err));
            throw err;
          }
        });
      } catch (err) {
        results[name] = { error: String(err) };
      }
    };

    if (want("alesc")) {
      for (const y of years(ALESC_FIRST_YEAR)) await run(`alesc ${y}`, () => ingestAlescYear(this.env, y));
      for (const y of years(ALESC_FIRST_YEAR)) await run(`alesc pagamentos ${y}`, () => ingestAlescPaymentsYear(this.env, y));
    }
    if (want("pmf")) {
      for (const y of years(EPUBLICA_FIRST_YEAR)) await run(`pmf favorecidos ${y}`, () => ingestPayeesYear(this.env, ENTITY_PMF, y));
      for (const y of years(EPUBLICA_FIRST_YEAR)) await run(`pmf diarias ${y}`, () => ingestPerDiemYear(this.env, ENTITY_PMF, y));
    }
    if (want("cmf")) {
      for (const y of years(EPUBLICA_FIRST_YEAR)) await run(`cmf favorecidos ${y}`, () => ingestPayeesYear(this.env, ENTITY_CMF, y));
      await run("cmf comissionados", () => ingestStaffSnapshot(this.env, ENTITY_CMF));
    }
    if (want("pncp")) for (const y of years(PNCP_FIRST_YEAR)) await run(`pncp ${y}`, () => ingestPncpYear(this.env, PMF_CNPJ, y));
    if (want("camara")) for (const y of years(CAMARA_FIRST_YEAR)) await run(`camara ceap ${y}`, () => ingestCamaraYear(this.env, y));
    if (want("senado")) for (const y of years(SENADO_FIRST_YEAR)) await run(`senado ceaps ${y}`, () => ingestSenadoYear(this.env, y));
    // Arquivo único com todo o histórico: sempre coletado inteiro.
    if (want("emendas")) await run("emendas", () => ingestEmendas(this.env));
    if (want("estado")) {
      for (const y of years(ESTADO_FIRST_YEAR)) await run(`estado empenhos ${y}`, () => ingestEstadoEmpenhosYear(this.env, y));
      await run("estado contratos", () => ingestEstadoContratos(this.env));
    }
    if (want("derive")) {
      await run("ligacoes", () => relinkMandates(this.env));
      await run("sinais", () => computeSignals(this.env));
    }
    return results;
  }

  private async log(instanceId: string, stepName: string, started: string, ok: boolean, summary: unknown) {
    await this.env.DB.prepare(
      "INSERT INTO ingest_run (instance_id, step, started_at, finished_at, ok, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
      .bind(instanceId, stepName, started, nowIso(), ok ? 1 : 0, JSON.stringify(summary).slice(0, 4000))
      .run();
  }
}
