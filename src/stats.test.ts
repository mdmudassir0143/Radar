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

  it("calls a stream of $0.20 x402 notes a micro use case", () => {
    const events = Array.from({ length: 20 }, (_, i) => ev(1_800_000_000 + i * 90, 0.2));
    const report = fraudReport(analysis(events));
    expect(report.use.kind).toBe("micro");
    expect(report.use.fit).toBeGreaterThanOrEqual(70);
    expect(report.use.medianTicket).toBeCloseTo(0.2);
  });

  it("flags a few $500 settles as leaderboard inflate, not x402 micros", () => {
    const events = [
      ev(1_800_000_000, 500),
      ev(1_800_086_400, 500),
      ev(1_800_172_800, 480),
    ];
    const report = fraudReport(analysis(events));
    expect(report.use.kind).toBe("inflate");
    expect(report.use.fit).toBeLessThan(40);
    expect(report.use.macroVolShare).toBeGreaterThan(0.9);
    expect(report.use.avgTicket).toBeGreaterThan(400);
  });

  it("calls a mix of cents and $80 tickets mixed", () => {
    const events = [
      ...Array.from({ length: 8 }, (_, i) => ev(1_800_000_000 + i * 80, 0.25)),
      ev(1_800_001_000, 80),
      ev(1_800_002_000, 80),
    ];
    const report = fraudReport(analysis(events));
    expect(report.use.kind).toBe("mixed");
  });

  it("flags many $1 settles plus a few $500 as inflate when volume is not micro", () => {
    const events = [
      ...Array.from({ length: 70 }, (_, i) => ev(1_800_000_000 + i * 60, 1)),
      ...Array.from({ length: 10 }, (_, i) => ev(1_800_100_000 + i * 1000, 400)),
    ];
    const report = fraudReport(analysis(events));
    expect(report.use.kind).toBe("inflate");
    expect(report.use.macroVolShare).toBeGreaterThan(0.9);
    expect(report.use.fit).toBeLessThan(50);
  });

  it("does not treat an independent metronome as synthetic — timing never decides", () => {
    const events = Array.from({ length: 16 }, (_, i) => ev(1_800_000_000 + i * 300, 1.5));
    const report = fraudReport(analysis(events));
    expect(report.kind).toBe("keeper");
    expect(report.policy.kind).toBe("clear");
    expect(report.policy.selfPay).toBe(0);
  });

  it("marks a live self-pay stream as synthetic even when the burst is short", () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      from: HUB,
      to: HUB,
      usdc: 0.01,
      time: 1_800_000_000 + i * 120,
      x402: true,
      kind: "in" as const,
    }));
    const report = fraudReport(analysis(events));
    expect(report.policy.selfPay).toBe(5);
    expect(report.policy.kind).toBe("synthetic");
  });

  it("flags the receiving address paying itself as a synthetic money path", () => {
    const events = Array.from({ length: 24 }, (_, i) => ({
      from: HUB,
      to: HUB,
      usdc: 0.05,
      time: 1_800_000_000 + i * 90,
      x402: true,
      kind: "in" as const,
    }));
    const report = fraudReport(analysis(events));
    expect(report.policy.selfPay).toBe(24);
    expect(report.policy.kind).toBe("synthetic");
  });

  it("counts payers the payTo funded before they paid back", () => {
    const events = [
      { from: HUB, to: P1, usdc: 2, time: 1_800_000_000, x402: false, kind: "out" as const },
      ...Array.from({ length: 20 }, (_, i) => ev(1_800_001_000 + i * 80, 0.1)),
    ];
    const report = fraudReport(analysis(events));
    expect(report.policy.fundedBack).toBe(20);
    expect(report.policy.kind).toBe("synthetic");
  });

  it("puts a live stream of sub-cent settles over the free monthly allowance on quota", () => {
    const events = Array.from({ length: 1100 }, (_, i) => ev(1_800_000_000 + i * 30, 0.005));
    const report = fraudReport(analysis(events));
    expect(report.policy.subcentMonth).toBeGreaterThan(1000);
    expect(report.policy.kind).toBe("quota");
  });

  it("calls inbound with no x402 notes plain", () => {
    const events = Array.from({ length: 6 }, (_, i) => ({
      ...ev(1_800_000_000 + i * 200, 0.4),
      x402: false,
    }));
    const report = fraudReport(analysis(events));
    expect(report.use.kind).toBe("plain");
    expect(report.use.x402Share).toBe(0);
  });
});
