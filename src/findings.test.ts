import { describe, expect, it } from "vitest";
import type { Analysis, FlowEvent } from "./api";
import { buildCoverage, dossierFor, findAnomalies, rollupEvents } from "./telemetry";

const HUB = "A".repeat(58);
const P1 = "B".repeat(58);
const P2 = "C".repeat(58);
const Q1 = "D".repeat(58);
const DAY = 86_400;
const LAST = 1_800_000_000;

function event(
  partial: Partial<FlowEvent> & Pick<FlowEvent, "from" | "to" | "usdc" | "time" | "kind">,
): FlowEvent {
  return { x402: false, ...partial };
}

function ready(events: FlowEvent[], extra: Partial<Analysis> = {}): Analysis {
  const rolled = rollupEvents(HUB, events);
  return {
    address: HUB,
    account: { algo: 1, usdc: 7, minBalance: 0.1, optedIn: 1 },
    merchant: null,
    daily: [],
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, usdc: 0, settles: 0 })),
    tickets: [],
    scannedPeers: 0,
    coverage: buildCoverage({
      pages: 1,
      lastRound: 1,
      rateLimits: 0,
      peersAsked: 0,
      peersSkipped: 0,
      x402OnChain: rolled.x402,
      facilitatorSettles: rolled.x402,
      received: rolled.payers.reduce((sum, row) => sum + row.usdc, 0),
      sent: rolled.outboundUsdc,
      held: 7,
      truncated: false,
    }),
    ...rolled,
    events,
    ...extra,
  };
}

describe("dossierFor", () => {
  const events = [
    event({ from: P1, to: HUB, usdc: 10, time: 100, kind: "in", x402: true }),
    event({ from: P1, to: HUB, usdc: 2, time: 140, kind: "in" }),
    event({ from: HUB, to: Q1, usdc: 4, time: 300, kind: "out" }),
    event({ from: HUB, to: P1, usdc: 1, time: 320, kind: "out" }),
  ];

  it("describes the payTo from inbound, outbound, and the live hold", () => {
    const card = dossierFor(ready(events), HUB);
    expect(card.role).toBe("payTo");
    expect(card.volumeIn).toBe(12);
    expect(card.volumeOut).toBe(5);
    expect(card.held).toBe(7);
    expect(card.first).toBe(100);
    expect(card.last).toBe(320);
  });

  it("marks a wallet that both paid and was paid as both", () => {
    const card = dossierFor(ready(events), P1);
    expect(card.role).toBe("both");
    expect(card.volumeIn).toBe(12);
    expect(card.volumeOut).toBe(1);
    expect(card.tickets).toEqual([
      { amount: 2, count: 1 },
      { amount: 10, count: 1 },
    ]);
  });
});

describe("findAnomalies", () => {
  it("flags a payer that first appeared in the last day of the window", () => {
    const hits = findAnomalies(
      ready([
        event({ from: P1, to: HUB, usdc: 3, time: LAST - DAY * 3, kind: "in" }),
        event({ from: P2, to: HUB, usdc: 3, time: LAST - 100, kind: "in" }),
      ]),
    );
    expect(hits.some((hit) => hit.id === `new_payer:${P2}`)).toBe(true);
    expect(hits.some((hit) => hit.id === `new_payer:${P1}`)).toBe(false);
  });

  it("flags a repeated ticket that looks like a bot", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      event({ from: P1, to: HUB, usdc: 0.01, time: LAST - 10 + i, kind: "in" }),
    );
    const hits = findAnomalies(ready(events));
    expect(hits.some((hit) => hit.kind === "bot_ticket")).toBe(true);
  });

  it("flags the first outbound after inbound", () => {
    const hits = findAnomalies(
      ready([
        event({ from: P1, to: HUB, usdc: 8, time: LAST - 500, kind: "in" }),
        event({ from: HUB, to: Q1, usdc: 2, time: LAST - 20, kind: "out" }),
      ]),
    );
    const hit = hits.find((row) => row.kind === "first_outbound");
    expect(hit?.address).toBe(Q1);
    expect(hit?.time).toBe(LAST - 20);
  });

  it("ignores an hour that is only a modest share of inbound", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      usdc: hour === 18 ? 18 : hour < 10 ? 8.2 : 0,
      settles: 1,
    }));
    const hits = findAnomalies(
      ready([event({ from: P1, to: HUB, usdc: 100, time: LAST, kind: "in" })], { hours }),
    );
    expect(hits.some((hit) => hit.kind === "hour_spike")).toBe(false);
  });

  it("flags an hour that takes most of the inbound volume", () => {
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      usdc: hour === 14 ? 80 : hour === 3 ? 5 : 0,
      settles: hour === 14 ? 8 : hour === 3 ? 1 : 0,
    }));
    const hits = findAnomalies(
      ready([event({ from: P1, to: HUB, usdc: 85, time: LAST, kind: "in" })], { hours }),
    );
    expect(hits.some((hit) => hit.kind === "hour_spike" && hit.detail.includes("14"))).toBe(true);
  });

  it("flags facilitator count mismatch", () => {
    const base = ready([event({ from: P1, to: HUB, usdc: 1, time: LAST, kind: "in", x402: true })]);
    const hits = findAnomalies({
      ...base,
      coverage: { ...base.coverage, x402OnChain: 1, facilitatorSettles: 9 },
    });
    expect(hits.some((hit) => hit.kind === "facilitator_mismatch")).toBe(true);
  });

  it("stays quiet on a mixed, well-spread pull", () => {
    const hits = findAnomalies(
      ready([
        event({ from: P1, to: HUB, usdc: 4, time: LAST - DAY * 4, kind: "in" }),
        event({ from: P2, to: HUB, usdc: 5, time: LAST - DAY * 3, kind: "in" }),
        event({ from: P1, to: HUB, usdc: 3, time: LAST - DAY, kind: "in" }),
      ]),
    );
    expect(hits).toEqual([]);
  });
});
