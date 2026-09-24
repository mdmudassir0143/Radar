import { describe, expect, it } from "vitest";
import type { Analysis, FlowEvent } from "./api";
import { buildCoverage, qualityLevel, sliceAnalysis } from "./telemetry";

const HUB = "A".repeat(58);

function event(partial: Partial<FlowEvent> & Pick<FlowEvent, "from" | "to" | "usdc" | "time" | "kind">): FlowEvent {
  return { x402: false, ...partial };
}

function coverage(partial: Partial<Parameters<typeof buildCoverage>[0]> = {}) {
  return buildCoverage({
    pages: 2,
    lastRound: 100,
    rateLimits: 0,
    peersAsked: 3,
    peersSkipped: 0,
    x402OnChain: 10,
    facilitatorSettles: 10,
    received: 10,
    sent: 3,
    held: 7,
    truncated: false,
    ...partial,
  });
}

function analysisOf(events: FlowEvent[]): Analysis {
  return {
    address: HUB,
    account: { algo: 1, usdc: 7, minBalance: 0.1, optedIn: 1 },
    merchant: null,
    payers: [],
    payees: [],
    edges: [],
    daily: [],
    hours: [],
    tickets: [],
    incoming: 0,
    x402: 0,
    outboundUsdc: 0,
    outboundTx: 0,
    scannedPeers: 0,
    first: 100,
    last: 300,
    events,
    coverage: coverage(),
  };
}

describe("buildCoverage", () => {
  it("sets unexplained to received minus sent minus held", () => {
    const row = coverage({ received: 12.5, sent: 4, held: 7.25 });
    expect(row.unexplained).toBeCloseTo(1.25);
  });
});

describe("qualityLevel", () => {
  it("is ok when the pull is complete and the books close", () => {
    expect(qualityLevel(coverage())).toBe("ok");
  });

  it("warns when USDC is unaccounted for", () => {
    expect(qualityLevel(coverage({ received: 10, sent: 3, held: 6 }))).toBe("warn");
  });

  it("warns when the payTo transfer pull was truncated", () => {
    expect(qualityLevel(coverage({ truncated: true }))).toBe("warn");
  });

  it("warns when a peer scan was skipped", () => {
    expect(qualityLevel(coverage({ peersSkipped: 1 }))).toBe("warn");
  });

  it("warns when the indexer rate-limited the pull", () => {
    expect(qualityLevel(coverage({ rateLimits: 2 }))).toBe("warn");
  });

  it("warns when x402 count disagrees with the facilitator", () => {
    expect(qualityLevel(coverage({ x402OnChain: 8, facilitatorSettles: 12 }))).toBe("warn");
  });
});

describe("sliceAnalysis", () => {
  const events: FlowEvent[] = [
    event({ from: "P1", to: HUB, usdc: 10, time: 100, kind: "in", x402: true }),
    event({ from: "P2", to: HUB, usdc: 5, time: 200, kind: "in" }),
    event({ from: HUB, to: "Q1", usdc: 4, time: 300, kind: "out" }),
    event({ from: "P1", to: "P2", usdc: 1, time: 250, kind: "peer" }),
  ];

  it("keeps only wallets and volume that existed by the scrub time", () => {
    const mid = sliceAnalysis(analysisOf(events), 200);
    expect(mid.payers.map((row) => row.address)).toEqual(["P1", "P2"]);
    expect(mid.payers[0].usdc).toBe(10);
    expect(mid.payees).toEqual([]);
    expect(mid.outboundUsdc).toBe(0);
    expect(mid.edges.every((edge) => edge.kind !== "out")).toBe(true);
  });

  it("lets later outbound and peer links appear as the clock advances", () => {
    const late = sliceAnalysis(analysisOf(events), 300);
    expect(late.payees).toHaveLength(1);
    expect(late.payees[0].usdc).toBe(4);
    expect(late.outboundUsdc).toBe(4);
    expect(late.edges.some((edge) => edge.kind === "peer")).toBe(true);
  });

  it("includes events with no timestamp so missing indexer time is not dropped", () => {
    const sliced = sliceAnalysis(
      analysisOf([event({ from: "P9", to: HUB, usdc: 2, time: 0, kind: "in" })]),
      50,
    );
    expect(sliced.payers).toHaveLength(1);
    expect(sliced.payers[0].usdc).toBe(2);
  });
});
