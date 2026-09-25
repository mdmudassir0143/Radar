import type { Analysis, FlowEvent } from "./api";
import { delayStats, inboundTimes, type DelayStats } from "./stats";

export type MachineKind = "human" | "script" | "engine" | "keeper";

export type FraudSignal = {
  label: string;
  value: string;
  hint: string;
  hot: boolean;
};

export type FraudReport = {
  kind: MachineKind;
  score: number;
  summary: string;
  signals: FraudSignal[];
  delays: DelayStats;
  topTicketShare: number;
  hourCoverage: number;
  intervalSnap: number;
  sameSecond: number;
  settlesPerDay: number;
};

const CRON = [60, 120, 180, 300, 600, 900, 1800, 3600];

function ticketShare(events: FlowEvent[]): number {
  const inbound = events.filter((event) => event.kind === "in");
  if (!inbound.length) return 0;
  const counts = new Map<number, number>();
  for (const event of inbound) {
    const key = Math.round(event.usdc * 1e6);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / inbound.length;
}

function hourCoverage(events: FlowEvent[]): number {
  const hours = new Set<number>();
  for (const event of events) {
    if (event.kind !== "in" || !event.time) continue;
    hours.add(new Date(event.time * 1000).getUTCHours());
  }
  return hours.size / 24;
}

function intervalSnap(gaps: number[]): number {
  if (!gaps.length) return 0;
  let hits = 0;
  for (const gap of gaps) {
    if (CRON.some((tick) => Math.abs(gap - tick) <= Math.max(8, tick * 0.08))) hits += 1;
  }
  return hits / gaps.length;
}

function sameSecond(times: number[]): number {
  const map = new Map<number, number>();
  for (const time of times) map.set(time, (map.get(time) ?? 0) + 1);
  return [...map.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0);
}

function settlesPerDay(analysis: Analysis): number {
  const inbound = analysis.events.filter((event) => event.kind === "in" && event.time);
  if (inbound.length < 2) return inbound.length;
  const span = Math.max(analysis.last! - analysis.first!, 1);
  return inbound.length / (span / 86400);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function fraudReport(analysis: Analysis): FraudReport {
  const delays = delayStats(analysis.events);
  const times = inboundTimes(analysis.events);
  const inbound = analysis.events.filter((event) => event.kind === "in");
  const topTicketShare = ticketShare(analysis.events);
  const hours = hourCoverage(analysis.events);
  const snap = intervalSnap(delays.gaps);
  const stacked = sameSecond(times);
  const pace = settlesPerDay(analysis);

  let score = 8;
  if (inbound.length >= 8 && delays.cv > 0 && delays.cv < 0.22) score += 34;
  else if (inbound.length >= 8 && delays.cv < 0.45) score += 18;
  if (inbound.length >= 8 && topTicketShare >= 0.7) score += 24;
  else if (inbound.length >= 8 && topTicketShare >= 0.45) score += 12;
  if (hours >= 18 / 24) score += 16;
  else if (hours >= 12 / 24) score += 8;
  if (snap >= 0.4) score += 20;
  else if (snap >= 0.25) score += 10;
  if (stacked >= 4) score += 8;
  if (pace >= 50) score += 14;
  else if (pace >= 20) score += 8;
  if (inbound.length < 5) score = Math.min(score, 22);

  score = clamp(score);

  let kind: MachineKind = "human";
  if (inbound.length >= 8 && snap >= 0.35 && topTicketShare >= 0.6 && delays.cv < 0.35) {
    kind = "keeper";
  } else if (inbound.length >= 12 && hours >= 0.5 && topTicketShare >= 0.55 && pace >= 8) {
    kind = "engine";
  } else if (inbound.length >= 8 && (topTicketShare >= 0.7 || (delays.cv < 0.45 && snap >= 0.25))) {
    kind = "script";
  }
  if (score < 40) kind = "human";

  const summary =
    kind === "keeper"
      ? "Settles land on a clock. Same ticket, regular gap — this looks like a keeper or cron."
      : kind === "engine"
        ? "Volume is high, hours are covered, and tickets repeat. This looks like an engine looping payments."
        : kind === "script"
          ? "The cadence or ticket mix is too clean for ad-hoc paying. This looks scripted."
          : "Gaps and ticket sizes look uneven. Nothing here requires a script, engine, or keeper.";

  const signals: FraudSignal[] = [
    {
      label: "median delay",
      value: delays.median ? `${Math.round(delays.median)}s` : "—",
      hint: "Time between inbound settles",
      hot: inbound.length >= 8 && delays.cv < 0.35,
    },
    {
      label: "delay spread",
      value: delays.cv ? delays.cv.toFixed(2) : "—",
      hint: "Lower means a metronome",
      hot: inbound.length >= 8 && delays.cv < 0.35,
    },
    {
      label: "top ticket",
      value: `${(topTicketShare * 100).toFixed(0)}%`,
      hint: "Share of inbound at one price",
      hot: topTicketShare >= 0.55,
    },
    {
      label: "UTC hours used",
      value: `${Math.round(hours * 24)} / 24`,
      hint: "A human rarely covers the whole clock",
      hot: hours >= 0.5,
    },
    {
      label: "cron-like gaps",
      value: `${(snap * 100).toFixed(0)}%`,
      hint: "Gaps near 1m, 5m, 15m, 1h",
      hot: snap >= 0.25,
    },
    {
      label: "same-second hits",
      value: String(stacked),
      hint: "Stacked settles in one second",
      hot: stacked >= 4,
    },
    {
      label: "settles / day",
      value: pace ? pace.toFixed(1) : "—",
      hint: "Inbound pace over the window",
      hot: pace >= 20,
    },
  ];

  return {
    kind,
    score,
    summary,
    signals,
    delays,
    topTicketShare,
    hourCoverage: hours,
    intervalSnap: snap,
    sameSecond: stacked,
    settlesPerDay: pace,
  };
}
