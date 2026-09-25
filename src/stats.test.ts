import { describe, expect, it } from "vitest";
import type { FlowEvent } from "./api";
import { delayStats } from "./stats";
import { fraudReport } from "./fraud";
import { buildCoverage, rollupEvents } from "./telemetry";

const HUB = "A".repeat(58);
const P1 = "B".repeat(58);

function ev(time: number, usdc = 1): FlowEvent {
  return { from: P1, to: HUB, usdc, time, x402: true, kind: "in" };
}

function analysis(events: FlowEvent[]) {
  const rolled = rollupEvents(HUB, events);
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, usdc: 0, settles: 0 }));
  for (const event of events) {
    if (!event.time || event.kind !== "in") continue;
    const hour = new Date(event.time * 1000).getUTCHours();
    hours[hour].usdc += event.usdc;
    hours[hour].settles += 1;
  }
  return {
    address: HUB,
    account: null,
    merchant: null,
    daily: [],
    hours,
    tickets: [],
    scannedPeers: 0,
    coverage: buildCoverage({
      pages: 1,
      lastRound: 1,
      rateLimits: 0,
      peersAsked: 0,
      peersSkipped: 0,
      x402OnChain: events.length,
      facilitatorSettles: events.length,
      received: events.reduce((sum, row) => sum + row.usdc, 0),
      sent: 0,
      held: 0,
      truncated: false,
    }),
    ...rolled,
    events,
  };
}

describe("delayStats", () => {
  it("measures a steady 60s cadence", () => {
    const row = delayStats([ev(1000), ev(1060), ev(1120), ev(1180)]);
    expect(row.median).toBe(60);
    expect(row.mean).toBe(60);
    expect(row.cv).toBeLessThan(0.05);
  });

  it("gives a high spread when gaps jump around", () => {
    const row = delayStats([ev(1000), ev(1010), ev(8000), ev(8030)]);
    expect(row.cv).toBeGreaterThan(1);
  });
});

describe("fraudReport", () => {
  it("calls a metronome of the same ticket a keeper", () => {
    const events = Array.from({ length: 16 }, (_, i) => ev(1_800_000_000 + i * 300, 1.5));
    const report = fraudReport(analysis(events));
    expect(report.kind).toBe("keeper");
    expect(report.score).toBeGreaterThanOrEqual(60);
  });

  it("calls a high-volume same-ticket 24h stream an engine", () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      ev(1_800_000_000 + i * 1400 + (i % 5) * 11, 0.2),
    );
    const report = fraudReport(analysis(events));
    expect(report.kind).toBe("engine");
    expect(report.score).toBeGreaterThanOrEqual(50);
  });

  it("stays human on a few mixed tickets and uneven gaps", () => {
    const events = [
      ev(1_800_000_000, 3.17),
      ev(1_800_004_200, 0.4),
      ev(1_800_090_000, 12),
      ev(1_800_091_000, 1.11),
    ];
    const report = fraudReport(analysis(events));
    expect(report.kind).toBe("human");
    expect(report.score).toBeLessThan(40);
  });
});
