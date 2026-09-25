import { useState, type MouseEvent } from "react";
import { shortAddr, type Analysis, type WalletEdge } from "./api";
import { IN, OUT, PEER } from "./graphs";
import type { DelayStats } from "./stats";

const MUTE = "var(--mute)";
const INK = "var(--ink)";
const RULE = "var(--rule)";

const LINES = [
  IN,
  "var(--ice)",
  PEER,
  OUT,
  "var(--warn)",
  "var(--share-5)",
  "var(--mute)",
  "#8fa0c4",
];

function usdShort(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  if (n >= 100) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(2)}`;
}

function linePath(
  vals: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  let d = "";
  let drawing = false;
  vals.forEach((v, i) => {
    if (v == null) {
      drawing = false;
      return;
    }
    d += `${drawing ? "L" : "M"} ${x(i)} ${y(v)} `;
    drawing = true;
  });
  return d.trim();
}

export function MultiLine({
  title,
  labels,
  series,
  teams,
  picked,
  onPick,
}: {
  title: string;
  labels: string[];
  series: { id?: string; name: string; values: (number | null)[] }[];
  teams?: { id: string; name: string; rank: number }[];
  picked?: string;
  onPick?: (id: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const focus = picked || null;
  const w = 760;
  const h = 300;
  const pad = { l: 52, r: 16, t: 20, b: 36 };
  const nums = series.flatMap((row) => row.values.filter((v): v is number => v != null));
  const max = Math.max(...nums, 0.01);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) =>
    pad.l + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const skip = labels.length > 8 ? Math.ceil(labels.length / 7) : 1;
  const ticks = [0, 0.5, 1];
  let latest = labels.length - 1;
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    if (series.some((row) => row.values[i] != null)) {
      latest = i;
      break;
    }
  }
  const day = hover ?? latest;
  const dayRows = series
    .map((row, i) => ({
      name: row.name,
      value: row.values[day] ?? null,
      color: LINES[i % LINES.length],
    }))
    .filter((row) => row.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const dayTotal = dayRows.reduce((sum, row) => sum + (row.value ?? 0), 0);

  function nearest(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * w;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < labels.length; i += 1) {
      const d = Math.abs(x(i) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    setHover(best);
  }

  return (
    <div className="instrument wide">
      <div className="chart-head">
        <div>
          <p className="meta">{title}</p>
          <p className="chart-hint">Hover a day for USDC.</p>
        </div>
        {teams?.length && onPick ? (
          <label className="chart-pick">
            <span>Team</span>
            <select value={picked ?? ""} onChange={(event) => onPick(event.target.value)}>
              <option value="">Top 6 overlay</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.rank}. {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="instrument-svg tall"
          onMouseMove={nearest}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={pad.l}
                x2={w - pad.r}
                y1={y(max * t)}
                y2={y(max * t)}
                stroke={RULE}
              />
              <text x={pad.l - 8} y={y(max * t) + 4} textAnchor="end" fill={MUTE} fontSize="11">
                {usdShort(max * t)}
              </text>
            </g>
          ))}
          {series.map((row, i) => {
            const dim = focus != null && focus !== row.name;
            return (
              <path
                key={row.name}
                d={linePath(row.values, x, y)}
                fill="none"
                stroke={LINES[i % LINES.length]}
                strokeWidth={focus === row.name ? 3 : 2.2}
                opacity={dim ? 0.16 : 0.95}
              />
            );
          })}
          {series.map((row, i) =>
            row.values.map((v, j) =>
              v == null ? null : (
                <circle
                  key={`${row.name}-${j}`}
                  cx={x(j)}
                  cy={y(v)}
                  r={hover === j ? 4.5 : 3}
                  fill={LINES[i % LINES.length]}
                  opacity={focus != null && focus !== row.name ? 0.16 : 1}
                />
              ),
            ),
          )}
          {hover != null ? (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={pad.t}
              y2={h - pad.b}
              stroke={INK}
              strokeOpacity="0.35"
            />
          ) : null}
          {labels.map((label, i) =>
            i % skip === 0 ? (
              <text
                key={`${label}-${i}`}
                x={x(i)}
                y={h - 10}
                textAnchor="middle"
                fill={hover === i ? INK : MUTE}
                fontSize="11"
              >
                {label}
              </text>
            ) : null,
          )}
        </svg>
        {!series.some((row) => row.values.some((value) => value != null)) ? (
          <p className="chart-hint">No volume history for this team yet.</p>
        ) : null}
        {dayRows.length ? (
          <div className="chart-tip">
            <b>
              {labels[day]}
              <span>{usdShort(dayTotal)} that day</span>
            </b>
            <ul>
              {dayRows.map((row) => (
                <li key={row.name} className={focus === row.name ? "on" : ""}>
                  <i style={{ background: row.color }} />
                  <em>{row.name}</em>
                  <strong>{usdShort(row.value ?? 0)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="legend tight">
        {series.map((row, i) => (
          <span
            key={row.id ?? row.name}
            className="swatch custom"
            style={{ ["--swatch" as string]: LINES[i % LINES.length] }}
          >
            {row.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClimbBars({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; value: number }[];
}) {
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      {rows.map((row) => (
        <div key={row.label} className="deg">
          <span className="mono">{row.label}</span>
          <div className="deg-track">
            <div
              className={`deg-fill${row.value < 0 ? " down" : row.value > 0 ? "" : " flat"}`}
              style={{ width: `${(Math.abs(row.value) / max) * 100}%` }}
            />
          </div>
          <span className="num">
            {row.value > 0 ? `↑${row.value}` : row.value < 0 ? `↓${-row.value}` : "•"}
          </span>
        </div>
      ))}
    </div>
  );
}

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
  names = { inbound: "in", outbound: "out", peer: "peer" },
}: {
  title: string;
  inbound: number;
  outbound: number;
  peer: number;
  names?: { inbound: string; outbound: string; peer: string };
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
        <span className="swatch in">
          {inbound} {names.inbound}
        </span>
        <span className="swatch out">
          {outbound} {names.outbound}
        </span>
        {peer ? (
          <span className="swatch peer">
            {peer} {names.peer}
          </span>
        ) : null}
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

export function VolumeBars({
  title,
  labels,
  values,
}: {
  title: string;
  labels: string[];
  values: number[];
}) {
  const max = Math.max(...values, 0.01);
  const w = 760;
  const h = 180;
  const pad = { l: 36, r: 10, t: 16, b: 28 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const gap = 3;
  const bar = Math.max(2, innerW / Math.max(values.length, 1) - gap);
  const skip = values.length > 10 ? Math.ceil(values.length / 8) : 1;

  return (
    <div className="instrument wide">
      <p className="meta">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="instrument-svg">
        {values.map((value, i) => {
          const x = pad.l + i * (bar + gap);
          const bh = (value / max) * innerH;
          return (
            <g key={`${labels[i]}-${i}`}>
              <rect
                x={x}
                y={pad.t + innerH - bh}
                width={bar}
                height={bh}
                rx="2"
                fill={IN}
                opacity={0.9}
              />
              {i % skip === 0 ? (
                <text x={x + bar / 2} y={h - 8} textAnchor="middle" fill={MUTE} fontSize="10">
                  {labels[i]}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function CumulLine({
  title,
  labels,
  values,
}: {
  title: string;
  labels: string[];
  values: number[];
}) {
  const w = 420;
  const h = 180;
  const pad = { l: 36, r: 10, t: 18, b: 28 };
  const max = Math.max(...values, 0.01);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) =>
    pad.l + (values.length <= 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  const skip = values.length > 8 ? Math.ceil(values.length / 6) : 1;

  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="instrument-svg">
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={pad.l} x2={w - pad.r} y1={y(max * t)} y2={y(max * t)} stroke={RULE} />
        ))}
        <path d={path} fill="none" stroke={IN} strokeWidth="2" />
        {labels.map((label, i) =>
          i % skip === 0 ? (
            <text key={`${label}-${i}`} x={x(i)} y={h - 8} textAnchor="middle" fill={MUTE} fontSize="10">
              {label}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}

export function Gauge({
  title,
  value,
  cap,
  warn = "high",
}: {
  title: string;
  value: number;
  cap: string;
  warn?: "high" | "low";
}) {
  const n = Math.max(0, Math.min(100, value));
  const r = 52;
  const c = 2 * Math.PI * r;
  const len = (n / 100) * c * 0.75;
  const rest = c - len;
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      <svg viewBox="0 0 140 120" className="instrument-svg ring">
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={RULE}
          strokeWidth="12"
          strokeDasharray={`${c * 0.75} ${c}`}
          transform="rotate(135 70 70)"
        />
        <circle
          cx="70"
          cy="70"
          r={r}
          fill="none"
          stroke={(warn === "low" ? n < 50 : n >= 40) ? "var(--warn)" : IN}
          strokeWidth="12"
          strokeDasharray={`${len} ${rest}`}
          transform="rotate(135 70 70)"
        />
        <text x="70" y="66" textAnchor="middle" fill={INK} fontSize="22">
          {Math.round(n)}
        </text>
        <text x="70" y="86" textAnchor="middle" fill={MUTE} fontSize="10">
          {cap}
        </text>
      </svg>
    </div>
  );
}

export function Meter({
  title,
  value,
  max,
  hint,
  hot,
}: {
  title: string;
  value: number;
  max: number;
  hint: string;
  hot?: boolean;
}) {
  const pct = Math.min(100, (value / Math.max(max, 0.01)) * 100);
  return (
    <div className={`instrument${hot ? " hot" : ""}`}>
      <p className="meta">{title}</p>
      <p className="meter-val">{hint}</p>
      <div className="deg-track tall">
        <div className="deg-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Spark({ title, values, hint }: { title: string; values: number[]; hint: string }) {
  const w = 420;
  const h = 160;
  const pad = { l: 10, r: 10, t: 16, b: 20 };
  const max = Math.max(...values, 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const x = (i: number) =>
    pad.l + (values.length <= 1 ? innerW / 2 : (i / (values.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const path = values.map((v, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(v)}`).join(" ");
  return (
    <div className="instrument wide">
      <p className="meta">{title}</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="instrument-svg">
        <path d={path} fill="none" stroke={IN} strokeWidth="1.8" />
      </svg>
      <p className="meta">{hint}</p>
    </div>
  );
}

export function DelayHist({ title, stats }: { title: string; stats: DelayStats }) {
  const max = Math.max(...stats.buckets.map((row) => row.count), 1);
  return (
    <div className="instrument">
      <p className="meta">{title}</p>
      {stats.buckets.map((row) => (
        <div key={row.label} className="deg">
          <span className="mono">{row.label}</span>
          <div className="deg-track">
            <div className="deg-fill" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
          <span className="num">{row.count}</span>
        </div>
      ))}
    </div>
  );
}
