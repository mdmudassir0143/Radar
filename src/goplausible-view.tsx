import { useEffect, useMemo, useState } from "react";
import { loadChallengeBoard, loadMerchantPulses } from "./api";
import { attachSparks, alignSparks, boardTotals, mergeBoards, type TeamRow } from "./board";
import { ClimbBars, DegreeBars, Meter, MixBars, MultiLine, ShareRing, VolumeBars } from "./charts";

const TICKET = [
  "var(--in)",
  "var(--ice)",
  "var(--peer)",
  "var(--out)",
  "var(--share-5)",
  "var(--mute)",
];

function money(n: number): string {
  if (n >= 1000) return `$${n.toFixed(0)}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export function GoPlausibleView() {
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [all, month, week, day] = await Promise.all([
          loadChallengeBoard("all"),
          loadChallengeBoard("30d"),
          loadChallengeBoard("7d"),
          loadChallengeBoard("24h"),
        ]);
        const merged = mergeBoards(all, month, week, day);
        if (live) setRows(merged);
        try {
          const sparks = await loadMerchantPulses(merged.slice(0, 20).map((row) => row.id));
          if (live) setRows(attachSparks(merged, sparks));
        } catch {
          /* ranks and volume still stand if sparklines fail */
        }
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "Could not read the challenge board");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const totals = useMemo(() => (rows ? boardTotals(rows) : null), [rows]);
  const pool = useMemo(() => (rows ? alignSparks(rows, 20) : { labels: [], series: [] }), [rows]);
  const chart = useMemo(() => {
    const series = picked ? pool.series.filter((row) => row.id === picked) : pool.series.slice(0, 6);
    return { labels: pool.labels, series };
  }, [pool, picked]);
  const top20 = (rows ?? []).slice(0, 20).map((row) => ({
    id: row.id,
    name: row.name,
    rank: row.rankAll,
  }));
  const hasChart = pool.series.some((row) => row.values.some((value) => value != null));
  const top = rows?.slice(0, 12) ?? [];
  const dayTop = [...(rows ?? [])].sort((a, b) => b.vol24 - a.vol24).slice(0, 12);
  const climbers = [...(rows ?? [])]
    .filter((row) => row.climb24 != null)
    .sort((a, b) => (b.climb24 ?? 0) - (a.climb24 ?? 0));
  const restVol = Math.max(0, (totals?.volAll ?? 0) - top.slice(0, 5).reduce((sum, row) => sum + row.volAll, 0));

  if (error) return <p className="status bad">{error}</p>;
  if (!rows || !totals) return <p className="status">Reading the x402 global challenge board…</p>;

  return (
    <div className="goplausible">
      <section className="instruments">
        <Meter title="Teams on the board" value={totals.teams} max={Math.max(totals.teams, 1)} hint={`${totals.teams} challenge merchants`} />
        <Meter
          title="All-time USDC"
          value={totals.volAll}
          max={Math.max(totals.volAll, 1)}
          hint={`${money(totals.volAll)} across the challenge`}
        />
        <Meter
          title="Last 24h USDC"
          value={totals.vol24}
          max={Math.max(totals.volAll, 1)}
          hint={`${money(totals.vol24)} · ${money(totals.vol7)} in 7d`}
          hot={totals.vol24 > totals.volAll * 0.08}
        />
        <Meter
          title="Rank climbers (24h)"
          value={totals.climbing}
          max={Math.max(totals.teams, 1)}
          hint={`${totals.climbing} up · ${totals.falling} down vs all-time rank`}
          hot={totals.climbing >= 8}
        />
      </section>

      {hasChart ? (
        <section className="instruments">
          <MultiLine
            title="Volume over time — top teams"
            labels={chart.labels}
            series={chart.series}
            teams={top20}
            picked={picked}
            onPick={setPicked}
          />
        </section>
      ) : null}

      <section className="instruments">
        <DegreeBars
          title="All-time volume"
          rows={top.map((row) => ({ label: row.name, value: Number(row.volAll.toFixed(2)) }))}
        />
        <DegreeBars
          title="Last 24h volume"
          rows={dayTop
            .filter((row) => row.vol24 > 0)
            .map((row) => ({ label: row.name, value: Number(row.vol24.toFixed(2)) }))}
        />
        <DegreeBars
          title="Last 7d volume"
          rows={[...rows]
            .sort((a, b) => b.vol7 - a.vol7)
            .slice(0, 12)
            .filter((row) => row.vol7 > 0)
            .map((row) => ({ label: row.name, value: Number(row.vol7.toFixed(2)) }))}
        />
        <ShareRing
          title="Who holds the all-time USDC"
          slices={[
            ...top.slice(0, 5).map((row, i) => ({
              label: row.name,
              value: row.volAll,
              color: TICKET[i] ?? "var(--mute)",
            })),
            ...(restVol > 0 ? [{ label: "rest of board", value: restVol, color: "var(--mute)" }] : []),
          ]}
        />
        <ClimbBars
          title="Rank up vs all-time — last 24h"
          rows={climbers.slice(0, 10).map((row) => ({ label: row.name, value: row.climb24 ?? 0 }))}
        />
        <ClimbBars
          title="Rank down vs all-time — last 24h"
          rows={climbers
            .slice(-10)
            .reverse()
            .map((row) => ({ label: row.name, value: row.climb24 ?? 0 }))}
        />
        <MixBars
          title="USDC now vs this week vs all-time"
          inbound={totals.vol24}
          outbound={Math.max(0, totals.vol7 - totals.vol24)}
          peer={Math.max(0, totals.volAll - totals.vol7)}
          names={{ inbound: "24h", outbound: "7d rest", peer: "older" }}
        />
        <VolumeBars
          title="24h USDC by team"
          labels={dayTop.filter((row) => row.vol24 > 0).map((row) => row.name.slice(0, 8))}
          values={dayTop.filter((row) => row.vol24 > 0).map((row) => row.vol24)}
        />
      </section>

      <p className="meta">
        Ranks and volume come from the GoPlausible x402 global challenge merchant board. A climb is
        all-time rank minus 24h rank — positive means the team is hotter now than its all-time seat.
        Time series are facilitator sparklines for the current top 20.
      </p>
    </div>
  );
}
