import { shortAddr, type Analysis, type WalletEdge } from "./api";
import { IN, OUT, PEER } from "./graphs";

const MUTE = "var(--mute)";
const INK = "var(--ink)";
const RULE = "var(--rule)";

export function DualLine({
  title,
  labels,
  inbound,
  outbound,
}: {
  title: string;
  labels: string[];
  inbound: number[];
  outbound: number[];
}) {
  const w = 420;
  const h = 180;
  const pad = { l: 36, r: 10, t: 18, b: 28 };
  const max = Math.max(...inbound, ...outbound, 0.01);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) =>
    pad.l + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const path = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");

  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="instrument-svg">
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={pad.l}
            x2={w - pad.r}
            y1={y(max * t)}
            y2={y(max * t)}
            stroke={RULE}
          />
        ))}
        <path d={path(inbound)} fill="none" stroke={IN} strokeWidth="2" />
        <path d={path(outbound)} fill="none" stroke={OUT} strokeWidth="2" />
        {labels.map((label, i) => (
          <text key={label} x={x(i)} y={h - 8} textAnchor="middle" fill={MUTE} fontSize="10">
            {label}
          </text>
        ))}
      </svg>
      <div className="legend tight">
        <span className="swatch in">in</span>
        <span className="swatch out">out</span>
      </div>
    </div>
  );
}

export function ClockBars({
  title,
  hours,
}: {
  title: string;
  hours: { hour: number; usdc: number }[];
}) {
  const max = Math.max(...hours.map((h) => h.usdc), 0.01);
  const cx = 110;
  const cy = 110;
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <svg viewBox="0 0 220 220" className="instrument-svg clock">
        {hours.map((slot) => {
          const angle = ((slot.hour - 6) / 24) * Math.PI * 2;
          const len = 28 + (slot.usdc / max) * 62;
          return (
            <line
              key={slot.hour}
              x1={cx + Math.cos(angle) * 22}
              y1={cy + Math.sin(angle) * 22}
              x2={cx + Math.cos(angle) * len}
              y2={cy + Math.sin(angle) * len}
              stroke={IN}
              strokeWidth={slot.usdc ? 4 : 1}
              opacity={slot.usdc ? 0.95 : 0.25}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={18} fill="var(--panel)" stroke={RULE} />
        <text x={cx} y={cy + 4} textAnchor="middle" fill={INK} fontSize="10">
          UTC
        </text>
        <text x={cx} y={24} textAnchor="middle" fill={MUTE} fontSize="9">
          00
        </text>
        <text x={196} y={cy + 3} textAnchor="middle" fill={MUTE} fontSize="9">
          06
        </text>
        <text x={cx} y={206} textAnchor="middle" fill={MUTE} fontSize="9">
          12
        </text>
        <text x={24} y={cy + 3} textAnchor="middle" fill={MUTE} fontSize="9">
          18
        </text>
      </svg>
    </div>
  );
}

export function ShareRing({
  title,
  slices,
}: {
  title: string;
  slices: { label: string; value: number; color: string }[];
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  let acc = 0;
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <div className="ring-wrap">
        <svg viewBox="0 0 140 140" className="instrument-svg ring">
          <circle cx="70" cy="70" r={r} fill="none" stroke={RULE} strokeWidth="14" />
          {slices.map((slice) => {
            const len = (slice.value / total) * c;
            const dash = `${len} ${c - len}`;
            const rot = (acc / total) * 360 - 90;
            acc += slice.value;
            return (
              <circle
                key={slice.label}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth="14"
                strokeDasharray={dash}
                transform={`rotate(${rot} 70 70)`}
              />
            );
          })}
          <text x="70" y="74" textAnchor="middle" fill={INK} fontSize="12">
            {slices.length}
          </text>
        </svg>
        <ul className="ring-key">
          {slices.map((slice) => (
            <li key={slice.label}>
              <i style={{ background: slice.color }} />
              {slice.label}
              <b>{((slice.value / total) * 100).toFixed(0)}%</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DegreeBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      {rows.map((row) => (
        <div key={row.label} className="deg">
          <span className="mono">{row.label}</span>
          <div className="deg-track">
            <div className="deg-fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </div>
          <span className="num">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function MixBars({
  title,
  inbound,
  outbound,
  peer,
}: {
  title: string;
  inbound: number;
  outbound: number;
  peer: number;
}) {
  const total = inbound + outbound + peer || 1;
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <div className="mix">
        <span style={{ width: `${(inbound / total) * 100}%`, background: IN }} />
        <span style={{ width: `${(outbound / total) * 100}%`, background: OUT }} />
        <span style={{ width: `${(peer / total) * 100}%`, background: PEER }} />
      </div>
      <div className="legend tight">
        <span className="swatch in">{inbound} in</span>
        <span className="swatch out">{outbound} out</span>
        <span className="swatch peer">{peer} peer</span>
      </div>
    </div>
  );
}

function band(i: number, n: number, top: number, h: number) {
  const gap = h / Math.max(n, 1);
  return top + gap * i + gap / 2;
}

export function FlowRiver({
  analysis,
  selected,
  onSelect,
}: {
  analysis: Analysis;
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  const left = analysis.payers.slice(0, 8);
  const right = analysis.payees.slice(0, 8);
  const w = 760;
  const h = Math.max(220, Math.max(left.length, right.length, 1) * 28 + 48);
  const lx = 130;
  const rx = 630;
  const cx = 380;
  const cy = h / 2;
  const inMax = Math.max(...left.map((row) => row.usdc), 0.01);
  const outMax = Math.max(...right.map((row) => row.usdc), 0.01);

  return (
    <div className="instrument wide">
      <p className="meta">Money path — payers into the payTo, then out to other wallets</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="instrument-svg river">
        {left.map((row, i) => {
          const y = band(i, left.length, 16, h - 32);
          const hot = !selected || selected === row.address || selected === analysis.address;
          return (
            <g key={`in-${row.address}`} className="node" onClick={() => onSelect(row.address)}>
              <path
                d={`M ${lx} ${y} C ${lx + 90} ${y}, ${cx - 90} ${cy}, ${cx} ${cy}`}
                fill="none"
                stroke={IN}
                strokeWidth={1.2 + (row.usdc / inMax) * 7}
                opacity={hot ? 0.85 : 0.18}
              />
              <text x={lx - 8} y={y + 4} textAnchor="end" fill={hot ? INK : MUTE} fontSize="11">
                {shortAddr(row.address)}
              </text>
            </g>
          );
        })}
        {right.map((row, i) => {
          const y = band(i, right.length, 16, h - 32);
          const hot = !selected || selected === row.address || selected === analysis.address;
          return (
            <g key={`out-${row.address}`} className="node" onClick={() => onSelect(row.address)}>
              <path
                d={`M ${cx} ${cy} C ${cx + 90} ${cy}, ${rx - 90} ${y}, ${rx} ${y}`}
                fill="none"
                stroke={OUT}
                strokeWidth={1.2 + (row.usdc / outMax) * 7}
                opacity={hot ? 0.85 : 0.18}
              />
              <text x={rx + 8} y={y + 4} textAnchor="start" fill={hot ? INK : MUTE} fontSize="11">
                {shortAddr(row.address)}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r="22" fill="var(--hub)" stroke={IN} strokeWidth="2" />
        <text x={cx} y={cy + 4} textAnchor="middle" fill={INK} fontSize="11">
          payTo
        </text>
      </svg>
    </div>
  );
}

export function WhereNow({
  received,
  held,
  sent,
}: {
  received: number;
  held: number;
  sent: number;
}) {
  const rest = Math.max(0, received - held - sent);
  const total = received || held + sent || 1;
  const rows = [
    { label: "still on payTo", value: held, color: IN },
    { label: "sent onward", value: sent, color: OUT },
    { label: "not in this pull", value: rest, color: PEER },
  ].filter((row) => row.value > 0.0001);

  return (
    <div className="instrument">
      <p className="meta">Where the received USDC is now</p>
      <div className="mix tall">
        {rows.map((row) => (
          <span
            key={row.label}
            style={{ width: `${(row.value / total) * 100}%`, background: row.color }}
          />
        ))}
      </div>
      <ul className="ring-key">
        {rows.map((row) => (
          <li key={row.label}>
            <i style={{ background: row.color }} />
            {row.label}
            <b>
              ${row.value.toFixed(2)} · {((row.value / total) * 100).toFixed(0)}%
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LinkGrid({
  hub,
  edges,
  selected,
  onSelect,
}: {
  hub: string;
  edges: WalletEdge[];
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  const wallets: string[] = [];
  const seen = new Set<string>();
  const push = (addr: string) => {
    if (seen.has(addr) || wallets.length >= 8) return;
    seen.add(addr);
    wallets.push(addr);
  };
  push(hub);
  for (const edge of edges) {
    push(edge.from);
    push(edge.to);
  }
  if (wallets.length < 2) return null;
  const cell = new Map<string, number>();
  let max = 0.01;
  for (const edge of edges) {
    if (!seen.has(edge.from) || !seen.has(edge.to)) continue;
    const key = `${edge.from}>${edge.to}`;
    const next = (cell.get(key) ?? 0) + edge.usdc;
    cell.set(key, next);
    max = Math.max(max, next);
  }
  const size = 22;
  const label = 52;
  const box = label + wallets.length * size + 8;

  return (
    <div className="instrument">
      <p className="meta">Who paid whom in this cluster</p>
      <svg viewBox={`0 0 ${box + 8} ${box + 8}`} className="instrument-svg">
        {wallets.map((col, x) => (
          <text
            key={`c-${col}`}
            x={label + x * size + size / 2}
            y={label - 8}
            textAnchor="middle"
            fill={MUTE}
            fontSize="8"
          >
            {col === hub ? "payTo" : col.slice(0, 4)}
          </text>
        ))}
        {wallets.map((row, y) => (
          <g key={row}>
            <text
              x={label - 6}
              y={label + y * size + size / 2 + 3}
              textAnchor="end"
              fill={row === selected ? INK : MUTE}
              fontSize="8"
            >
              {row === hub ? "payTo" : row.slice(0, 4)}
            </text>
            {wallets.map((col, x) => {
              const value = cell.get(`${row}>${col}`) ?? 0;
              const t = value / max;
              return (
                <rect
                  key={`${row}-${col}`}
                  x={label + x * size + 1}
                  y={label + y * size + 1}
                  width={size - 2}
                  height={size - 2}
                  rx="2"
                  fill={value ? IN : RULE}
                  opacity={value ? 0.25 + t * 0.75 : 0.35}
                  className="node"
                  onClick={() => onSelect(row === hub ? col : row)}
                >
                  <title>{`${shortAddr(row)} → ${shortAddr(col)} · $${value.toFixed(2)}`}</title>
                </rect>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
