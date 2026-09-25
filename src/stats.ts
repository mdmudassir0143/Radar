import type { FlowEvent } from "./api";

export type DelayStats = {
  gaps: number[];
  median: number;
  p90: number;
  mean: number;
  cv: number;
  buckets: { label: string; count: number }[];
};

export function inboundTimes(events: FlowEvent[]): number[] {
  return events
    .filter((event) => event.kind === "in" && event.time)
    .map((event) => event.time)
    .sort((a, b) => a - b);
}

export function gapsOf(times: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i += 1) gaps.push(times[i] - times[i - 1]);
  return gaps;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

const BUCKETS = [
  { label: "<10s", test: (n: number) => n < 10 },
  { label: "10–60s", test: (n: number) => n < 60 },
  { label: "1–5m", test: (n: number) => n < 300 },
  { label: "5–30m", test: (n: number) => n < 1800 },
  { label: "30m–2h", test: (n: number) => n < 7200 },
  { label: "2h+", test: (_n: number) => true },
];

export function delayStats(events: FlowEvent[]): DelayStats {
  const gaps = gapsOf(inboundTimes(events));
  if (!gaps.length) {
    return {
      gaps,
      median: 0,
      p90: 0,
      mean: 0,
      cv: 0,
      buckets: BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 })),
    };
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const mean = gaps.reduce((sum, n) => sum + n, 0) / gaps.length;
  const variance = gaps.reduce((sum, n) => sum + (n - mean) ** 2, 0) / gaps.length;
  const std = Math.sqrt(variance);
  const buckets = BUCKETS.map((bucket) => ({ label: bucket.label, count: 0 }));
  for (const gap of gaps) {
    const slot = BUCKETS.findIndex((bucket) => bucket.test(gap));
    buckets[slot].count += 1;
  }
  return {
    gaps,
    median: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    mean,
    cv: mean ? std / mean : 0,
    buckets,
  };
}

export function formatGap(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}
