// Desenho de um ciclo de dinheiro: participantes num círculo, setas curvas no sentido
// do dinheiro e o valor de cada ligação. A cor indica o tipo de participante, sempre
// acompanhada de rótulo (a cor nunca carrega a informação sozinha).
import { brlCompact } from "~/lib/format";

export type NodeKind = "politico" | "partido" | "empresa" | "pessoa";
export interface CycleNode {
  key: string;
  label: string;
  kind: NodeKind;
  slug: string | null;
  doc: string | null;
}
export interface CycleStep {
  from: string;
  to: string;
  cents: number;
  kinds: { kind: string; cents: number }[];
}

export const KIND_NAME: Record<NodeKind, string> = {
  politico: "Político",
  partido: "Partido",
  empresa: "Empresa",
  pessoa: "Pessoa física",
};
export const EDGE_NAME: Record<string, string> = {
  doacao: "doação",
  campanha: "pagamento de campanha",
  cota: "cota parlamentar",
  emenda: "emenda",
  gabinete: "verba de gabinete",
  socio: "sócio (provável)",
};
const PUBLIC = new Set(["cota", "emenda", "gabinete"]);

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function KindLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {(Object.keys(KIND_NAME) as NodeKind[]).map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full" style={{ background: `var(--k-${k})` }} aria-hidden />
          {KIND_NAME[k]}
        </li>
      ))}
      <li className="inline-flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden>
          <line x1="1" y1="4" x2="21" y2="4" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        Dinheiro público (cota, emenda, gabinete)
      </li>
      <li className="inline-flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden>
          <line x1="1" y1="4" x2="21" y2="4" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="1.5 4" strokeLinecap="round" />
        </svg>
        Sócio da empresa (vínculo provável, não é dinheiro)
      </li>
    </ul>
  );
}

export function CycleGraph({ nodes, steps, size = "lg" }: { nodes: CycleNode[]; steps: CycleStep[]; size?: "lg" | "sm" }) {
  const lg = size === "lg";
  const W = lg ? 720 : 300;
  const pair = nodes.length === 2;
  const H = lg ? 470 : pair ? 140 : 200;
  const cx = W / 2;
  const cy = pair && !lg ? H / 2 - 10 : H / 2;
  const R = nodes.length === 2 ? (lg ? 170 : 82) : lg ? 165 : 62;
  const nodeR = lg ? 20 : 11;
  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const a = nodes.length === 2 ? (i === 0 ? Math.PI : 0) : -Math.PI / 2 + (i * 2 * Math.PI) / nodes.length;
    pos.set(n.key, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });
  const markerId = `arrow-${size}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Ciclo: ${nodes.map((n) => n.label).join(", depois ")}, voltando a ${nodes[0]?.label}. Os valores estão na tabela.`}>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth={lg ? 7 : 5} markerHeight={lg ? 7 : 5} orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--ink-2)" />
        </marker>
      </defs>
      {steps.map((s, i) => {
        const a = pos.get(s.from)!;
        const b = pos.get(s.to)!;
        // Curva para dentro do círculo (os nomes ficam do lado de fora). Com 2 participantes,
        // cada sentido curva para um lado.
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len;
        let ny = dx / len;
        if (nodes.length > 2 && (mx - cx) * nx + (my - cy) * ny > 0) {
          nx = -nx;
          ny = -ny;
        }
        const bend = nodes.length === 2 ? len * 0.32 : len * 0.12;
        const qx = mx + nx * bend;
        const qy = my + ny * bend;
        // Encurta as pontas para a seta não entrar no círculo.
        const trim = (px: number, py: number, tx: number, ty: number) => {
          const d = Math.hypot(tx - px, ty - py) || 1;
          return { x: px + ((tx - px) / d) * (nodeR + 4), y: py + ((ty - py) / d) * (nodeR + 4) };
        };
        const p0 = trim(a.x, a.y, qx, qy);
        const p1 = trim(b.x, b.y, qx, qy);
        const lx = 0.25 * p0.x + 0.5 * qx + 0.25 * p1.x;
        const ly = 0.25 * p0.y + 0.5 * qy + 0.25 * p1.y;
        const isPublic = s.kinds.some((k) => PUBLIC.has(k.kind));
        // Sócio não é dinheiro: linha pontilhada, sem valor.
        const isPartner = s.kinds.every((k) => k.kind === "socio");
        const text = isPartner ? "sócio" : brlCompact(s.cents);
        const kindText = isPartner ? "vínculo provável" : s.kinds.map((k) => EDGE_NAME[k.kind] ?? k.kind).join(" + ");
        const boxW = lg ? Math.max(text.length * 7.6, kindText.length * 5.6) + 16 : text.length * 5.4 + 10;
        const boxH = lg ? 34 : 15;
        return (
          <g key={i}>
            <path
              d={`M${p0.x},${p0.y} Q${qx},${qy} ${p1.x},${p1.y}`}
              fill="none"
              stroke="var(--ink-2)"
              strokeWidth={lg ? 1.8 : 1.3}
              strokeDasharray={isPartner ? "1.5 4" : isPublic ? "6 4" : undefined}
              strokeLinecap={isPartner ? "round" : undefined}
              markerEnd={`url(#${markerId})`}
            />
            <rect x={lx - boxW / 2} y={ly - boxH / 2} width={boxW} height={boxH} rx={lg ? 7 : 4} fill="var(--surface)" stroke="var(--border)" />
            <text x={lx} y={lg ? ly - 3 : ly + 3.5} textAnchor="middle" fontSize={lg ? 13 : 9} fontWeight={600} fill="var(--ink)" className="num">
              {text}
            </text>
            {lg && (
              <text x={lx} y={ly + 11} textAnchor="middle" fontSize={10} fill="var(--ink-3)">
                {kindText}
              </text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.key)!;
        // Nome para fora, na direção do nó a partir do centro.
        const vx = p.x - cx;
        const vy = p.y - cy;
        const vl = Math.hypot(vx, vy) || 1;
        const ux = vx / vl;
        const uy = vy / vl;
        const gap = nodeR + (lg ? 10 : 6);
        // Nos cards pequenos com 2 participantes, o nome vai embaixo do nó (cabe melhor).
        const under = !lg && pair;
        const vertical = under || Math.abs(ux) < 0.35;
        const anchor = vertical ? "middle" : ux > 0 ? "start" : "end";
        const tx = p.x + ux * gap;
        const tx2 = under ? p.x : tx;
        const ty = under ? p.y + gap + 8 : vertical ? (uy < 0 ? p.y - gap - (lg ? 16 : 4) : p.y + gap + (lg ? 12 : 8)) : p.y + uy * gap + (lg ? 0 : 3);
        return (
          <g key={n.key}>
            <circle cx={p.x} cy={p.y} r={nodeR} fill={`var(--k-${n.kind})`} stroke="var(--surface)" strokeWidth={lg ? 3 : 2} />
            <text x={p.x} y={p.y + (lg ? 5 : 3.5)} textAnchor="middle" fontSize={lg ? 14 : 9} fontWeight={700} fill="#fff">
              {n.label.charAt(0)}
            </text>
            <text x={tx2} y={ty} textAnchor={under ? "middle" : anchor} fontSize={lg ? 13 : 9} fontWeight={600} fill="var(--ink)">
              {short(n.label, lg ? (vertical ? 30 : 22) : under ? 14 : vertical ? 16 : 12)}
            </text>
            {lg && (
              <text x={tx} y={ty + 14} textAnchor={anchor} fontSize={10.5} fill="var(--ink-3)">
                {KIND_NAME[n.kind]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
