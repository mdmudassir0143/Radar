import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { shortAddr, type Analysis, type EdgeKind, type WalletEdge } from "./api";

export const IN = "var(--in)";
export const OUT = "var(--out)";
export const PEER = "var(--peer)";
export const ICE = "var(--ice)";
const MUTE = "var(--mute)";
const INK = "var(--ink)";
const RULE = "var(--rule)";
const VOID = "var(--void)";
const NODE = "var(--node)";
const HUB = "var(--hub)";
const GLOW = "var(--glow)";

const WIDTH = 1000;
const HEIGHT = 640;

export function kindColor(kind: EdgeKind): string {
  if (kind === "out") return OUT;
  if (kind === "peer") return PEER;
  return IN;
}

export function kindLabel(kind: EdgeKind): string {
  if (kind === "in") return "into payTo";
  if (kind === "out") return "from payTo";
  return "between wallets";
}

type Pt = { x: number; y: number };
export type GraphView = "in" | "out" | "cluster";

function ring(i: number, n: number, cx: number, cy: number, r: number): Pt {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function clusterNodes(analysis: Analysis, mode: GraphView) {
  const hub = analysis.address;
  if (mode === "in") {
    return {
      hub,
      outer: analysis.payers.slice(0, 24).map((row) => row.address),
      inner: [] as string[],
    };
  }
  if (mode === "out") {
    return {
      hub,
      outer: analysis.payees.slice(0, 24).map((row) => row.address),
      inner: [] as string[],
    };
  }
  const outer = analysis.payers.slice(0, 20).map((row) => row.address);
  const inner = analysis.payees
    .slice(0, 20)
    .map((row) => row.address)
    .filter((addr) => addr !== hub && !outer.includes(addr));
  return { hub, outer, inner };
}

function layoutFor(analysis: Analysis, mode: GraphView): Record<string, Pt> {
  const { hub, outer, inner } = clusterNodes(analysis, mode);
  const next: Record<string, Pt> = {
    [hub]: { x: WIDTH / 2, y: HEIGHT / 2 + 8 },
  };
  outer.forEach((addr, i) => {
    next[addr] = ring(i, outer.length, WIDTH / 2, HEIGHT / 2 + 8, 230);
  });
  inner.forEach((addr, i) => {
    next[addr] = ring(i, inner.length || 1, WIDTH / 2, HEIGHT / 2 + 8, 132);
  });
  return next;
}

function svgCoords(svg: SVGSVGElement, clientX: number, clientY: number): Pt {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  const mapped = pt.matrixTransform(ctm.inverse());
  return { x: mapped.x, y: mapped.y };
}

export function edgesForWallet(edges: WalletEdge[], address: string): WalletEdge[] {
  return edges.filter((edge) => edge.from === address || edge.to === address);
}

export function DraggableMap({
  analysis,
  mode,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  mode: GraphView;
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pos, setPos] = useState<Record<string, Pt>>({});
  const [view, setView] = useState({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
  const drag = useRef<
    | { kind: "node"; id: string; ox: number; oy: number }
    | { kind: "pan"; cx: number; cy: number; vx: number; vy: number }
    | null
  >(null);
  const moved = useRef(false);

  const { hub, outer, inner } = useMemo(
    () => clusterNodes(analysis, mode),
    [analysis, mode],
  );
  const nodes = useMemo(() => [hub, ...outer, ...inner], [hub, outer, inner]);
  const visible = useMemo(() => new Set(nodes), [nodes]);
  const edges = useMemo(
    () =>
      analysis.edges.filter(
        (edge) =>
          visible.has(edge.from) &&
          visible.has(edge.to) &&
          (mode === "cluster" ||
            (mode === "in" && edge.kind === "in") ||
            (mode === "out" && edge.kind === "out")),
      ),
    [analysis.edges, visible, mode],
  );
  const max = Math.max(...edges.map((edge) => edge.usdc), 0.01);
  const flow = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of edges) {
      map.set(edge.from, (map.get(edge.from) ?? 0) + edge.usdc);
      map.set(edge.to, (map.get(edge.to) ?? 0) + edge.usdc);
    }
    return map;
  }, [edges]);

  const layoutKey = useRef(`${analysis.address}:${mode}`);

  useEffect(() => {
    const key = `${analysis.address}:${mode}`;
    const reset = layoutKey.current !== key;
    layoutKey.current = key;
    const next = layoutFor(analysis, mode);
    if (reset) {
      setPos(next);
      setView({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
      return;
    }
    setPos((prev) => {
      const merged = { ...prev };
      for (const [addr, pt] of Object.entries(next)) {
        if (!merged[addr]) merged[addr] = pt;
      }
      return merged;
    });
  }, [analysis, mode]);

  function reset() {
    setPos(layoutFor(analysis, mode));
    setView({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
  }

  function onPointerDown(event: ReactPointerEvent<Element>, id?: string) {
    const svg = svgRef.current;
    if (!svg) return;
    const p = svgCoords(svg, event.clientX, event.clientY);
    moved.current = false;
    if (id) {
      const node = pos[id];
      if (!node) return;
      drag.current = { kind: "node", id, ox: p.x - node.x, oy: p.y - node.y };
      onSelect(id);
    } else {
      drag.current = {
        kind: "pan",
        cx: event.clientX,
        cy: event.clientY,
        vx: view.x,
        vy: view.y,
      };
    }
    svg.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    const job = drag.current;
    if (!svg || !job) return;
    const p = svgCoords(svg, event.clientX, event.clientY);
    if (job.kind === "node") {
      moved.current = true;
      setPos((prev) => ({
        ...prev,
        [job.id]: { x: p.x - job.ox, y: p.y - job.oy },
      }));
    } else {
      const rect = svg.getBoundingClientRect();
      setView((prev) => ({
        ...prev,
        x: job.vx - ((event.clientX - job.cx) * prev.w) / rect.width,
        y: job.vy - ((event.clientY - job.cy) * prev.h) / rect.height,
      }));
    }
  }

  function onPointerUp() {
    drag.current = null;
  }

  function zoomBy(factor: number) {
    setView((prev) => {
      const w = Math.min(1800, Math.max(420, prev.w * factor));
      const h = w * (HEIGHT / WIDTH);
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      return {
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
      };
    });
  }

  const linked = new Set<string>();
  if (selected) {
    linked.add(selected);
    for (const edge of edges) {
      if (edge.from === selected) linked.add(edge.to);
      if (edge.to === selected) linked.add(edge.from);
    }
  }

  return (
    <div className="radar">
      <div className="radar-hud">
        <span>Drag a wallet to pull it · drag space to pan</span>
        <div className="zoom-controls">
          <button type="button" className="chip zoom" aria-label="Zoom out" onClick={() => zoomBy(1.18)}>
            −
          </button>
          <button type="button" className="chip zoom" aria-label="Zoom in" onClick={() => zoomBy(0.85)}>
            +
          </button>
          <button type="button" className="chip" onClick={reset}>
            Reset layout
          </button>
        </div>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        className="radar-svg"
        onPointerDown={(event) => onPointerDown(event)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <defs>
          <radialGradient id="voidglow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={GLOW} stopOpacity="0.5" />
            <stop offset="100%" stopColor={VOID} stopOpacity="0" />
          </radialGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect x={view.x} y={view.y} width={view.w} height={view.h} fill={VOID} />
        <circle cx={WIDTH / 2} cy={HEIGHT / 2 + 8} r={280} fill="url(#voidglow)" />
        {[90, 160, 230].map((r) => (
          <circle
            key={r}
            cx={WIDTH / 2}
            cy={HEIGHT / 2 + 8}
            r={r}
            fill="none"
            stroke={RULE}
            strokeDasharray="3 8"
          />
        ))}
        {edges.map((edge) => {
          const a = pos[edge.from];
          const b = pos[edge.to];
          if (!a || !b) return null;
          const hot = !selected || edge.from === selected || edge.to === selected;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          const vx = mx - WIDTH / 2;
          const vy = my - (HEIGHT / 2 + 8);
          const len = Math.hypot(vx, vy) || 1;
          const qx = mx + (vx / len) * 28;
          const qy = my + (vy / len) * 28;
          return (
            <path
              key={`${edge.from}-${edge.to}`}
              d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`}
              fill="none"
              stroke={hot ? kindColor(edge.kind) : RULE}
              strokeWidth={hot ? 1.4 + (edge.usdc / max) * 5 : 0.8}
              opacity={hot ? 0.95 : 0.22}
              filter={hot && selected ? "url(#glow)" : undefined}
            />
          );
        })}
        {nodes.map((addr) => {
          const p = pos[addr];
          if (!p) return null;
          const isHub = addr === hub;
          const on = addr === selected;
          const dim = Boolean(selected && !linked.has(addr));
          const size = isHub
            ? 28
            : 7 + Math.min(10, (flow.get(addr) ?? 0) / Math.max(max, 1) * 8);
          return (
            <g
              key={addr}
              className="node"
              onPointerDown={(event) => {
                event.stopPropagation();
                onPointerDown(event, addr);
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (!moved.current) onSelect(addr);
              }}
              opacity={dim ? 0.28 : 1}
            >
              {on ? (
                <circle cx={p.x} cy={p.y} r={size + 10} fill="none" stroke={ICE} strokeWidth="1" />
              ) : null}
              <circle
                cx={p.x}
                cy={p.y}
                r={size}
                fill={isHub ? HUB : on ? ICE : NODE}
                stroke={isHub ? IN : inner.includes(addr) ? OUT : on ? ICE : MUTE}
                strokeWidth={isHub ? 2 : 1.4}
                filter={on ? "url(#glow)" : undefined}
              />
              <text
                x={p.x}
                y={p.y + size + 14}
                textAnchor="middle"
                fill={on || isHub ? INK : MUTE}
                fontSize={isHub ? 12 : 10}
              >
                {isHub ? "payTo" : shortAddr(addr)}
              </text>
              {isHub ? (
                <text x={p.x} y={p.y + 4} textAnchor="middle" fill={IN} fontSize="10">
                  {shortAddr(addr)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
