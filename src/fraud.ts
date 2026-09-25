import type { Analysis, FlowEvent } from "./api";
import { delayStats, inboundTimes, type DelayStats } from "./stats";

export type MachineKind = "human" | "script" | "engine" | "keeper";
export type UseKind = "micro" | "mixed" | "inflate" | "plain";

export type UseCase = {
  kind: UseKind;
  fit: number;
  parts: { label: string; value: number }[];
  bands: { label: string; count: number; usdc: number }[];
  medianTicket: number;
  avgTicket: number;
  x402Share: number;
  volume: number;
  settles: number;
  dollarsPerSettle: number;
  microVolShare: number;
  largeVolShare: number;
  macroVolShare: number;
  macroCountShare: number;
};

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
  uniqueSeconds: number;
  settlesPerDay: number;
  cronBuckets: { label: string; count: number }[];
  cadence: number[];
  parts: { label: string; value: number }[];
  use: UseCase;
};

const CRON = [60, 120, 180, 300, 600, 900, 1800, 3600];
const CRON_LABEL: Record<number, string> = {
  60: "1m",
  120: "2m",
  180: "3m",
  300: "5m",
  600: "10m",
  900: "15m",
  1800: "30m",
  3600: "1h",
};

function nearCron(gap: number): number | null {
  for (const tick of CRON) {
    if (Math.abs(gap - tick) <= Math.max(8, tick * 0.08)) return tick;
  }
  return null;
}

export function cronBuckets(gaps: number[]): { label: string; count: number }[] {
  const counts = new Map<string, number>([
    ...CRON.map((tick) => [CRON_LABEL[tick], 0] as const),
    ["other", 0],
  ]);
  for (const gap of gaps) {
    const tick = nearCron(gap);
    const key = tick ? CRON_LABEL[tick] : "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

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
    if (nearCron(gap) != null) hits += 1;
  }
  return hits / gaps.length;
}

function sameSecond(times: number[]): { stacked: number; unique: number } {
  const map = new Map<number, number>();
  for (const time of times) map.set(time, (map.get(time) ?? 0) + 1);
  return {
    unique: map.size,
    stacked: [...map.values()].filter((n) => n > 1).reduce((sum, n) => sum + n, 0),
  };
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

const TICKET_BANDS = [
  { label: "<$1", test: (n: number) => n < 1 },
  { label: "$1–10", test: (n: number) => n < 10 },
  { label: "$10–100", test: (n: number) => n < 100 },
  { label: "$100+", test: (_n: number) => true },
];

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ticketBands(inbound: FlowEvent[]): { label: string; count: number; usdc: number }[] {
  const rows = TICKET_BANDS.map((band) => ({ label: band.label, count: 0, usdc: 0 }));
  for (const event of inbound) {
    const slot = TICKET_BANDS.findIndex((band) => band.test(event.usdc));
    rows[slot].count += 1;
    rows[slot].usdc += event.usdc;
  }
  return rows;
}

export function usecaseOf(inbound: FlowEvent[]): UseCase {
  const settles = inbound.length;
  const volume = inbound.reduce((sum, event) => sum + event.usdc, 0);
  const amounts = inbound.map((event) => event.usdc);
  const medianTicket = medianOf(amounts);
  const avgTicket = settles ? volume / settles : 0;
  const x402Share = settles ? inbound.filter((event) => event.x402).length / settles : 0;
  const bands = ticketBands(inbound);
  const microVolShare = volume ? (bands[0]?.usdc ?? 0) / volume : 0;
  const largeVolShare = volume ? ((bands[2]?.usdc ?? 0) + (bands[3]?.usdc ?? 0)) / volume : 0;
  const macroVolShare = volume ? (bands[3]?.usdc ?? 0) / volume : 0;
  const macroCountShare = settles ? (bands[3]?.count ?? 0) / settles : 0;
  const dollarsPerSettle = avgTicket;

  let kind: UseKind = "mixed";
  if (!settles || x402Share < 0.25) {
    kind = "plain";
  } else if (
    medianTicket >= 50 ||
    (avgTicket >= 50 && settles < 30) ||
    macroVolShare >= 0.7 ||
    (macroVolShare >= 0.5 && settles < 25) ||
    (volume >= 200 && settles <= 12)
  ) {
    kind = "inflate";
  } else if (
    x402Share >= 0.4 &&
    macroVolShare < 0.15 &&
    largeVolShare < 0.35 &&
    (medianTicket <= 2 || (medianTicket <= 10 && settles >= 8))
  ) {
    kind = "micro";
  }

  let fit = 48;
  if (x402Share >= 0.8) fit += 14;
  else if (x402Share >= 0.5) fit += 6;
  else if (x402Share < 0.25) fit -= 28;
  if (medianTicket <= 0.5) fit += 22;
  else if (medianTicket <= 2) fit += 14;
  else if (medianTicket <= 10) fit += 4;
  else if (medianTicket >= 100) fit -= 34;
  else if (medianTicket >= 20) fit -= 18;
  if (macroVolShare >= 0.8) fit -= 36;
  else if (macroVolShare >= 0.6) fit -= 26;
  else if (macroVolShare >= 0.3) fit -= 12;
  if (microVolShare >= 0.6) fit += 14;
  if (settles <= 8 && volume >= 200) fit -= 16;
  if (settles >= 20 && medianTicket <= 2) fit += 6;
  if (!settles) fit = 0;
  fit = clamp(fit);

  const parts: { label: string; value: number }[] = [];
  if (kind === "inflate") {
    if (macroVolShare >= 0.3) parts.push({ label: "$100+ of volume", value: Math.round(macroVolShare * 100) });
    if (macroVolShare - macroCountShare >= 0.4) {
      parts.push({
        label: "few tickets hold the $",
        value: Math.round((1 - macroCountShare) * 100),
      });
    }
    if (medianTicket >= 10) parts.push({ label: "median ticket $", value: Math.min(100, Math.round(medianTicket)) });
    if (settles <= 12 && volume >= 100) {
      parts.push({ label: "few settles, high $", value: Math.min(100, Math.round(volume / Math.max(settles, 1))) });
    }
  } else if (kind === "plain") {
    parts.push({ label: "missing x402 notes", value: Math.round((1 - x402Share) * 100) });
    if (macroVolShare >= 0.3) parts.push({ label: "$100+ of volume", value: Math.round(macroVolShare * 100) });
  } else if (kind === "micro") {
    parts.push({ label: "x402 notes", value: Math.round(x402Share * 100) });
    parts.push({ label: "micro volume", value: Math.round(microVolShare * 100) });
    parts.push({ label: "small median ticket", value: Math.round((1 - Math.min(medianTicket, 1)) * 100) });
  } else {
    parts.push({ label: "micro volume", value: Math.round(microVolShare * 100) });
    parts.push({ label: "$10+ volume", value: Math.round(largeVolShare * 100) });
  }
  if (!parts.length) parts.push({ label: "not enough inbound", value: 0 });

  return {
    kind,
    fit,
    parts,
    bands,
    medianTicket,
    avgTicket,
    x402Share,
    volume,
    settles,
    dollarsPerSettle,
    microVolShare,
    largeVolShare,
    macroVolShare,
    macroCountShare,
  };
}

export function fraudReport(analysis: Analysis): FraudReport {
  const delays = delayStats(analysis.events);
  const times = inboundTimes(analysis.events);
  const inbound = analysis.events.filter((event) => event.kind === "in");
  const topTicketShare = ticketShare(analysis.events);
  const hours = hourCoverage(analysis.events);
  const snap = intervalSnap(delays.gaps);
  const seconds = sameSecond(times);
  const stacked = seconds.stacked;
  const pace = settlesPerDay(analysis);
  const parts: { label: string; value: number }[] = [];

  let score = 8;
  if (inbound.length >= 8 && delays.cv > 0 && delays.cv < 0.22) {
    score += 34;
    parts.push({ label: "steady cadence", value: 34 });
  } else if (inbound.length >= 8 && delays.cv < 0.45) {
    score += 18;
    parts.push({ label: "fairly regular cadence", value: 18 });
  }
  if (inbound.length >= 8 && topTicketShare >= 0.7) {
    score += 24;
    parts.push({ label: "one ticket dominates", value: 24 });
  } else if (inbound.length >= 8 && topTicketShare >= 0.45) {
    score += 12;
    parts.push({ label: "ticket repeats often", value: 12 });
  }
  if (hours >= 18 / 24) {
    score += 16;
    parts.push({ label: "covers most UTC hours", value: 16 });
  } else if (hours >= 12 / 24) {
    score += 8;
    parts.push({ label: "covers half the clock", value: 8 });
  }
  if (snap >= 0.4) {
    score += 20;
    parts.push({ label: "cron-like gaps", value: 20 });
  } else if (snap >= 0.25) {
    score += 10;
    parts.push({ label: "some cron-like gaps", value: 10 });
  }
  if (stacked >= 4) {
    score += 8;
    parts.push({ label: "same-second stacks", value: 8 });
  }
  if (pace >= 50) {
    score += 14;
    parts.push({ label: "very high daily pace", value: 14 });
  } else if (pace >= 20) {
    score += 8;
    parts.push({ label: "high daily pace", value: 8 });
  }
  if (inbound.length < 5) score = Math.min(score, 22);
  if (!parts.length) parts.push({ label: "uneven human-like mix", value: score });

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
    uniqueSeconds: seconds.unique,
    settlesPerDay: pace,
    cronBuckets: cronBuckets(delays.gaps),
    cadence: delays.gaps.slice(0, 48),
    parts,
    use: usecaseOf(inbound),
  };
}
