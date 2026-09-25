import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  allo,
  analyzePayTo,
  loadAccount,
  shortAddr,
  type Analysis,
  type WalletEdge,
} from "./api";
import {
  DraggableMap,
  kindColor,
  kindLabel,
  type GraphView,
} from "./graphs";
import { ClockBars, CumulLine, DegreeBars, DelayHist, DualLine, FlowRiver, LinkGrid, MixBars, ShareRing, VolumeBars, WhereNow } from "./charts";
import { FraudView } from "./fraud-view";
import { GoPlausibleView } from "./goplausible-view";
import { AnomalyTape, DossierCard, QualityStrip, TimeScrub } from "./mission";
import { delayStats, formatGap } from "./stats";
import { dossierFor, findAnomalies, sliceAnalysis } from "./telemetry";

const SHARE = [
  "var(--in)",
  "var(--ice)",
  "var(--peer)",
  "var(--out)",
  "var(--share-5)",
  "var(--mute)",
];
type Theme = "dark" | "light";
const SNAP = "radar-session";

function readTheme(): Theme {
  const stored = localStorage.getItem("radar-theme");
  if (stored === "light" || stored === "dark") return stored;
  return "dark";
}

function usd(n: number, digits = 2): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function cleanPath(path: string): string {
  const next = path.replace(/\/+$/, "");
  return next || "/";
}

function go(to: string) {
  window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function readSnap(): {
  value?: string;
  analysis?: Analysis | null;
  selected?: string | null;
  graph?: GraphView;
  until?: number | null;
} {
  try {
    const raw = sessionStorage.getItem(SNAP);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function when(ts?: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16);
}

function Bars({
  rows,
  value,
  label,
}: {
  rows: { key: string; value: number }[];
  value: (n: number) => string;
  label: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 0.01);
  return (
    <div>
      <p className="meta">{label}</p>
      {rows.map((row) => (
        <div
          key={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "140px 1fr 72px",
            gap: 8,
            alignItems: "center",
            margin: "6px 0",
          }}
        >
          <span className="mono">{row.key}</span>
          <div style={{ height: 8, background: "var(--track)", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: 8,
                width: `${(row.value / max) * 100}%`,
                background: "var(--ice)",
                borderRadius: 999,
              }}
            />
          </div>
          <span className="num">{value(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function TraceLoader({ phase }: { phase: string | null }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      <i className="loader-ring" aria-hidden="true" />
      <p>{phase ?? "Tracing…"}</p>
    </div>
  );
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "dark") {
    return (
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path
          d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M15.4 14.6A6.2 6.2 0 0 1 9.4 8.6 5.6 5.6 0 1 0 15.4 14.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EdgeTable({
  edges,
  selected,
  onSelect,
}: {
  edges: WalletEdge[];
  selected: string | null;
  onSelect: (address: string) => void;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>Kind</th>
          <th>From</th>
          <th>To</th>
          <th className="num">USDC</th>
          <th className="num">Tx</th>
          <th className="num">x402</th>
          <th>First → last</th>
        </tr>
      </thead>
      <tbody>
        {edges.map((edge) => (
          <tr
            key={`${edge.from}-${edge.to}`}
            className={`clickable${
              edge.from === selected || edge.to === selected ? " sel" : ""
            }`}
            onClick={() => onSelect(edge.from === selected ? edge.to : edge.from)}
          >
            <td style={{ color: kindColor(edge.kind) }}>{kindLabel(edge.kind)}</td>
            <td className="mono">
              <a href={allo(edge.from)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                {shortAddr(edge.from)}
              </a>
            </td>
            <td className="mono">
              <a href={allo(edge.to)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                {shortAddr(edge.to)}
              </a>
            </td>
            <td className="num">{usd(edge.usdc)}</td>
            <td className="num">{edge.settles}</td>
            <td className="num">{edge.x402}</td>
            <td className="meta">
              {when(edge.first)} → {when(edge.last)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function App() {
  const snap = useMemo(readSnap, []);
  const [path, setPath] = useState(() => cleanPath(window.location.pathname));
  const premium = path === "/premium";
  const fraud = path === "/fraud";
  const goplausible = path === "/goplausible";
  const [value, setValue] = useState(snap.value ?? "");
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(snap.analysis ?? null);
  const [selected, setSelected] = useState<string | null>(snap.selected ?? null);
  const [graph, setGraph] = useState<GraphView>(snap.graph ?? "in");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [until, setUntil] = useState<number | null>(snap.until ?? null);
  const [playing, setPlaying] = useState(false);
  const [held, setHeld] = useState<number | null | undefined>(undefined);
  const runId = useRef(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("radar-theme", theme);
  }, [theme]);

  useEffect(() => {
    const onPop = () => setPath(cleanPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("payTo")) {
      url.searchParams.delete("payTo");
      window.history.replaceState(null, "", url);
    }
  }, []);

  useEffect(() => {
    sessionStorage.setItem(
      SNAP,
      JSON.stringify({ value, analysis, selected, graph, until }),
    );
  }, [value, analysis, selected, graph, until]);

  useEffect(() => {
    setUntil(analysis?.last ?? null);
    setPlaying(false);
  }, [analysis?.address, analysis?.last]);

  useEffect(() => {
    if (!analysis || !selected) {
      setHeld(undefined);
      return;
    }
    if (selected === analysis.address) {
      setHeld(analysis.account?.usdc ?? null);
      return;
    }
    setHeld(undefined);
    let live = true;
    void loadAccount(selected).then((snap) => {
      if (live) setHeld(snap?.usdc ?? null);
    });
    return () => {
      live = false;
    };
  }, [analysis, selected]);

  useEffect(() => {
    if (!playing || !analysis) return;
    const times = [...new Set(analysis.events.map((event) => event.time).filter(Boolean))].sort(
      (a, b) => a - b,
    );
    if (times.length < 2) {
      setPlaying(false);
      return;
    }
    const id = window.setInterval(() => {
      setUntil((prev) => {
        const cursor = prev ?? times[0];
        const next = times.find((time) => time > cursor);
        if (next == null) {
          setPlaying(false);
          return times[times.length - 1];
        }
        return next;
      });
    }, 380);
    return () => window.clearInterval(id);
  }, [playing, analysis]);

  async function run(address: string) {
    const payTo = address.trim().toUpperCase();
    const id = ++runId.current;
    setValue(payTo);
    setError(null);
    setLoading(true);
    setPhase("Starting lookup…");
    try {
      const next = await analyzePayTo(payTo, (message) => {
        if (runId.current === id) setPhase(message);
      });
      if (runId.current !== id) return;
      setError(null);
      setAnalysis(next);
      setSelected(next.address);
      setUntil(next.last);
      setPlaying(false);
      setGraph(next.payees.length ? "cluster" : next.payers.length ? "in" : "out");
    } catch (err) {
      if (runId.current !== id) return;
      setAnalysis(null);
      setError(err instanceof Error ? err.message : "Lookup failed");
    } finally {
      if (runId.current === id) {
        setLoading(false);
        setPhase(null);
      }
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void run(value);
  }

  const viewed = useMemo(() => {
    if (!analysis || until == null || until === analysis.last) return analysis;
    return sliceAnalysis(analysis, until);
  }, [analysis, until]);

  const findings = useMemo(() => (analysis ? findAnomalies(analysis) : []), [analysis]);
  const dossier = useMemo(
    () => (analysis && selected ? dossierFor(analysis, selected) : null),
    [analysis, selected],
  );

  const welcome = !premium && !fraud && !goplausible && !analysis && !loading;
  const delays = useMemo(() => (analysis ? delayStats(analysis.events) : null), [analysis]);
  const days =
    analysis?.first && analysis.last
      ? Math.max((analysis.last - analysis.first) / 86400, 1 / 24)
      : 1;
  const cumul = useMemo(() => {
    if (!analysis) return [];
    let acc = 0;
    return analysis.daily.map((row) => {
      acc += row.usdc;
      return acc;
    });
  }, [analysis]);
  const inflow = analysis?.payers.reduce((sum, row) => sum + row.usdc, 0) ?? 0;
  const peerCount = analysis?.edges.filter((edge) => edge.kind === "peer").length ?? 0;
  const clusterSize = analysis
    ? 1 +
      new Set([
        ...analysis.payers.map((row) => row.address),
        ...analysis.payees.map((row) => row.address),
      ]).size
    : 0;

  return (
    <div>
      <header className="nav">
        <div className="nav-inner">
          <div className="nav-left">
            <a
              className="brand"
              href="/"
              onClick={(event) => {
                event.preventDefault();
                go("/");
              }}
            >
              Radar
            </a>
          </div>
          <button
            type="button"
            className="theme-btn"
            aria-label={theme === "dark" ? "Switch to light" : "Switch to dark"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
      </header>

      <div className={`app${welcome ? " welcome" : ""}`}>
      {welcome ? (
        <div className="landing">
          <h1>See who paid a payTo, and where the USDC went</h1>
          <p>
            Paste a 58-character Algorand address. Radar reads inbound and outbound USDC, draws the wallet graph, and shows what is still sitting on the payTo.
          </p>
          <ul>
            <li>Wallets that sent USDC in</li>
            <li>Wallets this payTo paid</li>
            <li>Links between those wallets</li>
          </ul>
        </div>
      ) : (
        <p className="lede">
          {premium
            ? "Coverage, flags, wallet card, and every USDC edge in the cluster."
            : fraud
              ? "Whether inbound looks like x402 micros, or just a few large tickets on the leaderboard — then script, engine, or keeper."
              : goplausible
                ? "Every team on the GoPlausible x402 challenge board — volume over time, rank up and down."
                : "Paste a payTo address to map who sent USDC, who received it, and how those wallets connect."}
        </p>
      )}

      {!goplausible ? (
        <form className="trace-box" onSubmit={onSubmit}>
          <input
            name="payTo"
            aria-label="payTo address"
            placeholder="enter payto address"
            value={value}
            spellCheck={false}
            autoCapitalize="characters"
            onChange={(event) => setValue(event.target.value.trim())}
          />
          <button type="submit" disabled={loading}>
            {loading ? "Tracing…" : "Trace"}
          </button>
        </form>
      ) : null}

      {error ? <p className="status bad">{error}</p> : null}
      {loading ? <TraceLoader phase={phase} /> : null}

      {analysis && !premium && !fraud && !goplausible && !loading ? (
        <>
          <section className="kpis six">
            <div className="kpi">
              <b>{analysis.payers.length}</b>
              <span>wallets paid this payTo</span>
            </div>
            <div className="kpi">
              <b>{usd(inflow)}</b>
              <span>USDC received</span>
            </div>
            <div className="kpi">
              <b>{analysis.payees.length}</b>
              <span>wallets this payTo paid</span>
            </div>
            <div className="kpi">
              <b>{usd(analysis.outboundUsdc)}</b>
              <span>USDC sent out</span>
            </div>
            <div className="kpi">
              <b>{peerCount}</b>
              <span>links between other wallets</span>
            </div>
            <div className="kpi">
              <b>{analysis.account ? analysis.account.usdc.toFixed(2) : "—"}</b>
              <span>USDC still on payTo</span>
            </div>
          </section>

          <section className="kpis six">
            <div className="kpi">
              <b>{usd(inflow / days)}</b>
              <span>USDC in per day</span>
            </div>
            <div className="kpi">
              <b>{(analysis.incoming / days).toFixed(1)}</b>
              <span>settles per day</span>
            </div>
            <div className="kpi">
              <b>{delays ? formatGap(delays.median) : "—"}</b>
              <span>median delay</span>
            </div>
            <div className="kpi">
              <b>{delays ? formatGap(delays.p90) : "—"}</b>
              <span>p90 delay</span>
            </div>
            <div className="kpi">
              <b>{delays ? delays.cv.toFixed(2) : "—"}</b>
              <span>delay spread</span>
            </div>
            <div className="kpi">
              <b>{analysis.tickets[0] ? usd(analysis.tickets[0].amount, analysis.tickets[0].amount < 0.01 ? 4 : 2) : "—"}</b>
              <span>smallest ticket</span>
            </div>
          </section>

          <p className="meta">
            {analysis.merchant ? (
              <>
                {analysis.merchant.name}
                {analysis.merchant.rank ? ` · challenge rank ${analysis.merchant.rank}` : ""}
                {analysis.merchant.host ? ` · ${analysis.merchant.host}` : ""}
                {analysis.merchant.blocked ? ` · blocked: ${analysis.merchant.blocked}` : ""}
                {" · "}
                <a
                  href={`https://facilitator.goplausible.xyz/dashboard/merchant/${analysis.merchant.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  merchant page
                </a>
              </>
            ) : (
              "Not on the current challenge leaderboard — on-chain flows still shown."
            )}
            {" · "}
            <a href={allo(analysis.address)} target="_blank" rel="noreferrer">
              {shortAddr(analysis.address)}
            </a>
            {analysis.account
              ? ` · ${analysis.account.algo.toFixed(3)} ALGO · ${analysis.account.optedIn} ASA opt-in`
              : ""}
            {` · ${analysis.x402} x402 notes of ${analysis.incoming} inbound · ${analysis.outboundTx} outbound transfers · scanned ${analysis.scannedPeers} counterparties`}
          </p>

          <div className="stage">
            {analysis.edges.length && viewed ? (
              <DraggableMap
                analysis={viewed}
                mode={graph}
                selected={selected}
                onSelect={setSelected}
              />
            ) : (
              <p className="meta">No USDC edges to draw yet.</p>
            )}
            {analysis.first != null && analysis.last != null && until != null ? (
              <TimeScrub
                first={analysis.first}
                last={analysis.last}
                until={until}
                playing={playing}
                onChange={(time) => {
                  setPlaying(false);
                  setUntil(time);
                }}
                onToggle={() => {
                  if (playing) {
                    setPlaying(false);
                    return;
                  }
                  if (until != null && analysis.last != null && until >= analysis.last) {
                    setUntil(analysis.first);
                  }
                  setPlaying(true);
                }}
              />
            ) : null}
          </div>

          <section className="instruments">
            {viewed && (viewed.payers.length || viewed.payees.length) ? (
              <FlowRiver analysis={viewed} selected={selected} onSelect={setSelected} />
            ) : null}
            <WhereNow
              received={inflow}
              held={analysis.account?.usdc ?? 0}
              sent={analysis.outboundUsdc}
            />
            <LinkGrid
              hub={analysis.address}
              edges={analysis.edges}
              selected={selected}
              onSelect={setSelected}
            />
            {analysis.daily.length ? (
              <VolumeBars
                title="USDC received by UTC day"
                labels={analysis.daily.map((d) => d.day.slice(5))}
                values={analysis.daily.map((d) => d.usdc)}
              />
            ) : null}
            {analysis.daily.length ? (
              <DualLine
                title="USDC in vs out by UTC day"
                labels={analysis.daily.map((d) => d.day.slice(5))}
                inbound={analysis.daily.map((d) => d.usdc)}
                outbound={analysis.daily.map((d) => d.outUsdc)}
              />
            ) : null}
            {analysis.daily.length ? (
              <VolumeBars
                title="Inbound settles by UTC day"
                labels={analysis.daily.map((d) => d.day.slice(5))}
                values={analysis.daily.map((d) => d.settles)}
              />
            ) : null}
            {cumul.length ? (
              <CumulLine
                title="Cumulative USDC received"
                labels={analysis.daily.map((d) => d.day.slice(5))}
                values={cumul}
              />
            ) : null}
            {delays ? <DelayHist title="Delay between inbound settles" stats={delays} /> : null}
            <ClockBars title="Inbound volume by UTC hour" hours={analysis.hours} />
            <ShareRing
              title="Share of inbound USDC"
              slices={[
                ...analysis.payers.slice(0, 5).map((row, i) => ({
                  label: shortAddr(row.address),
                  value: row.usdc,
                  color: SHARE[i],
                })),
                analysis.payers.length > 5
                  ? {
                      label: "others",
                      value: analysis.payers.slice(5).reduce((sum, row) => sum + row.usdc, 0),
                      color: SHARE[5],
                    }
                  : null,
              ].filter((slice): slice is { label: string; value: number; color: string } => Boolean(slice))}
            />
            <DegreeBars
              title="Unique counterparties in this cluster"
              rows={Object.entries(
                analysis.edges.reduce<Record<string, Set<string>>>((acc, edge) => {
                  acc[edge.from] ??= new Set();
                  acc[edge.to] ??= new Set();
                  acc[edge.from].add(edge.to);
                  acc[edge.to].add(edge.from);
                  return acc;
                }, {}),
              )
                .map(([address, set]) => ({
                  label: address === analysis.address ? "payTo" : shortAddr(address),
                  value: set.size,
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, 8)}
            />
            <MixBars
              title="Directed routes by kind"
              inbound={analysis.edges.filter((edge) => edge.kind === "in").length}
              outbound={analysis.edges.filter((edge) => edge.kind === "out").length}
              peer={analysis.edges.filter((edge) => edge.kind === "peer").length}
            />
            <Bars
              label="Ticket sizes into payTo"
              rows={analysis.tickets.slice(0, 8).map((t) => ({
                key: usd(t.amount, t.amount < 0.01 ? 4 : 2),
                value: t.count,
              }))}
              value={(n) => String(n)}
            />
          </section>

          {analysis.payees.length ? (
            <section className="block">
              <h2>Wallets this payTo sent USDC to</h2>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Receiver</th>
                    <th className="num">Transfers</th>
                    <th className="num">USDC</th>
                    <th className="num">x402</th>
                    <th>First → last</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.payees.map((row, i) => (
                    <tr
                      key={row.address}
                      className={`clickable${row.address === selected ? " sel" : ""}`}
                      onClick={() => {
                        setSelected(row.address);
                        setGraph("out");
                      }}
                    >
                      <td className="num">{i + 1}</td>
                      <td className="mono">
                        <a href={allo(row.address)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {shortAddr(row.address)}
                        </a>
                      </td>
                      <td className="num">{row.settles}</td>
                      <td className="num">{usd(row.usdc)}</td>
                      <td className="num">{row.x402}</td>
                      <td className="meta">
                        {when(row.first)} → {when(row.last)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          <section className="block">
            <h2>Wallets that paid this payTo</h2>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Sender</th>
                  <th className="num">Settles</th>
                  <th className="num">USDC</th>
                  <th className="num">Share</th>
                  <th>First → last</th>
                </tr>
              </thead>
              <tbody>
                {analysis.payers.map((row, i) => (
                  <tr
                    key={row.address}
                    className={`clickable${row.address === selected ? " sel" : ""}`}
                    onClick={() => {
                      setSelected(row.address);
                      setGraph("in");
                    }}
                  >
                    <td className="num">{i + 1}</td>
                    <td className="mono">
                      <a href={allo(row.address)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {shortAddr(row.address)}
                      </a>
                    </td>
                    <td className="num">{row.settles}</td>
                    <td className="num">{usd(row.usdc)}</td>
                    <td className="num">{((row.usdc / (inflow || 1)) * 100).toFixed(1)}%</td>
                    <td className="meta">
                      {when(row.first)} → {when(row.last)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {analysis.merchant?.resources.length ? (
            <section className="block">
              <h2>Paid resources</h2>
              <table>
                <thead>
                  <tr>
                    <th>Method</th>
                    <th>Path</th>
                    <th className="num">Price</th>
                    <th className="num">Settles</th>
                    <th className="num">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.merchant.resources.slice(0, 15).map((row) => (
                    <tr key={`${row.method}-${row.path}`}>
                      <td>{row.method}</td>
                      <td className="mono">{row.path}</td>
                      <td className="num">{usd(row.price, 3)}</td>
                      <td className="num">{row.settles}</td>
                      <td className="num">{usd(row.volume)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      ) : null}

      {goplausible ? <GoPlausibleView /> : null}

      {(premium || fraud) && !goplausible && !analysis && !loading ? (
        <p className="status">
          {fraud
            ? "Trace a payTo on Radar first, then open /fraud."
            : "Trace a payTo on Radar first, then open Premium."}
        </p>
      ) : null}

      {analysis && fraud && !loading ? <FraudView analysis={analysis} /> : null}

      {analysis && premium && !loading ? (
        <>
          <QualityStrip coverage={analysis.coverage} />
          <AnomalyTape
            findings={findings}
            onOpen={(finding) => {
              if (finding.address) setSelected(finding.address);
              if (finding.time) {
                setPlaying(false);
                setUntil(finding.time);
              }
            }}
          />

          <div className="chips graph-tabs">
            <button
              type="button"
              className={`chip${graph === "in" ? " on" : ""}`}
              onClick={() => setGraph("in")}
            >
              Into payTo
            </button>
            <button
              type="button"
              className={`chip${graph === "out" ? " on" : ""}`}
              onClick={() => setGraph("out")}
            >
              Out of payTo
            </button>
            <button
              type="button"
              className={`chip${graph === "cluster" ? " on" : ""}`}
              onClick={() => setGraph("cluster")}
            >
              All connections
            </button>
          </div>

          <div className="legend">
            <span className="swatch in">into payTo</span>
            <span className="swatch out">from payTo</span>
            <span className="swatch peer">between wallets</span>
          </div>

          {dossier ? (
            <DossierCard
              card={dossier}
              held={held}
              onClose={() => setSelected(null)}
            />
          ) : null}

          <section className="block">
            <h2>Every USDC edge in the cluster</h2>
            <p className="meta">
              {analysis.edges.length} directed routes across {clusterSize} wallets.
              Peer links use the latest 1,000 USDC transfers on each of the top counterparties.
            </p>
            <EdgeTable edges={analysis.edges} selected={selected} onSelect={setSelected} />
          </section>
        </>
      ) : null}
      </div>
    </div>
  );
}
