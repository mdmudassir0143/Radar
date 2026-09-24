import { useState } from "react";
import { allo, shortAddr, type Coverage } from "./api";
import { qualityLevel, type Dossier, type Finding } from "./telemetry";

function money(n: number): string {
  if (Math.abs(n) < 0.005) return "$0.00";
  const sign = n < 0 ? "−" : "+";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function utcStamp(ts: number): string {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

function flags(coverage: Coverage): string[] {
  const notes: string[] = [];
  if (Math.abs(coverage.unexplained) >= 0.01) notes.push(`residual ${money(coverage.unexplained)}`);
  if (coverage.truncated) notes.push("transfer pull truncated");
  if (coverage.peersSkipped) notes.push(`${coverage.peersSkipped} peer gaps`);
  if (coverage.rateLimits) notes.push(`${coverage.rateLimits} indexer 429s`);
  if (
    coverage.facilitatorSettles != null &&
    coverage.facilitatorSettles !== coverage.x402OnChain
  ) {
    notes.push("facilitator count mismatch");
  }
  return notes;
}

export function QualityStrip({ coverage }: { coverage: Coverage }) {
  const level = qualityLevel(coverage);
  const notes = flags(coverage);
  const cells = [
    { k: "pages", v: String(coverage.pages), hot: false },
    {
      k: "last round",
      v: coverage.lastRound != null ? coverage.lastRound.toLocaleString("en-US") : "—",
      hot: false,
    },
    { k: "429s", v: String(coverage.rateLimits), hot: coverage.rateLimits > 0 },
    {
      k: "peer gaps",
      v: `${coverage.peersSkipped}/${coverage.peersAsked}`,
      hot: coverage.peersSkipped > 0,
    },
    {
      k: "x402 / fac",
      v: `${coverage.x402OnChain} / ${coverage.facilitatorSettles ?? "—"}`,
      hot:
        coverage.facilitatorSettles != null &&
        coverage.facilitatorSettles !== coverage.x402OnChain,
    },
    {
      k: "unexplained",
      v: money(coverage.unexplained),
      hot: Math.abs(coverage.unexplained) >= 0.01,
    },
  ];

  return (
    <section className={`telemetry${level === "warn" ? " warn" : ""}`}>
      <div className="telemetry-head">
        <i className="pip" aria-hidden="true" />
        <span>{level === "ok" ? "nominal" : "check"}</span>
      </div>
      <dl>
        {cells.map((cell) => (
          <div key={cell.k} className={cell.hot ? "hot" : undefined}>
            <dt>{cell.k}</dt>
            <dd>{cell.v}</dd>
          </div>
        ))}
      </dl>
      {notes.length ? <p className="telemetry-notes">{notes.join(" · ")}</p> : null}
    </section>
  );
}

export function TimeScrub({
  first,
  last,
  until,
  playing,
  onChange,
  onToggle,
}: {
  first: number;
  last: number;
  until: number;
  playing: boolean;
  onChange: (time: number) => void;
  onToggle: () => void;
}) {
  const span = Math.max(last - first, 1);
  const live = until >= last;

  return (
    <div className="scrub">
      <button
        type="button"
        className={`chip zoom${playing ? " on" : ""}`}
        aria-label={playing ? "Pause replay" : "Play replay"}
        onClick={onToggle}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={first}
        max={last}
        step={Math.max(1, Math.floor(span / 400))}
        value={until}
        aria-label="Replay time"
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <time dateTime={new Date(until * 1000).toISOString()}>
        {live ? "now" : utcStamp(until)}
      </time>
    </div>
  );
}

const ROLE: Record<Dossier["role"], string> = {
  payTo: "this payTo",
  payer: "paid this payTo",
  payee: "received from this payTo",
  both: "paid and was paid",
  peer: "linked in the cluster",
};

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function DossierCard({
  card,
  held,
  onClose,
}: {
  card: Dossier;
  held: number | null | undefined;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const tickets = card.tickets.slice(0, 3);
  const hold = held === undefined ? undefined : (held ?? card.held);

  async function copy() {
    try {
      await navigator.clipboard.writeText(card.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="dossier">
      <div className="dossier-top">
        <div>
          <p className="meta">{ROLE[card.role]}</p>
          <p className="dossier-addr">{card.address}</p>
        </div>
        <div className="dossier-actions">
          <button type="button" className="chip" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
          <a className="chip" href={allo(card.address)} target="_blank" rel="noreferrer">
            Allo
          </a>
          <button type="button" className="chip" onClick={onClose} aria-label="Close dossier">
            Close
          </button>
        </div>
      </div>
      <dl>
        <div>
          <dt>in</dt>
          <dd>{usd(card.volumeIn)}</dd>
        </div>
        <div>
          <dt>out</dt>
          <dd>{usd(card.volumeOut)}</dd>
        </div>
        <div>
          <dt>settles</dt>
          <dd>{card.settles}</dd>
        </div>
        <div>
          <dt>x402</dt>
          <dd>{card.x402}</dd>
        </div>
        <div>
          <dt>held</dt>
          <dd>{hold === undefined ? "…" : hold == null ? "—" : usd(hold)}</dd>
        </div>
        <div>
          <dt>first → last</dt>
          <dd>
            {card.first ? utcStamp(card.first) : "—"}
            <br />
            {card.last ? utcStamp(card.last) : "—"}
          </dd>
        </div>
      </dl>
      {tickets.length ? (
        <p className="meta">
          tickets{" "}
          {tickets.map((row) => `${usd(row.amount)} × ${row.count}`).join(" · ")}
        </p>
      ) : null}
    </aside>
  );
}

export function AnomalyTape({
  findings,
  onOpen,
}: {
  findings: Finding[];
  onOpen: (finding: Finding) => void;
}) {
  if (!findings.length) return null;
  return (
    <section className="tape">
      <p className="meta">Flags</p>
      <ul>
        {findings.map((finding) => (
          <li key={finding.id}>
            <button type="button" onClick={() => onOpen(finding)}>
              <b>{finding.title}</b>
              <span>
                {finding.detail}
                {finding.address ? ` · ${shortAddr(finding.address)}` : ""}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
