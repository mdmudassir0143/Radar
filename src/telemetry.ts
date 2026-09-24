import type { Analysis, Coverage, EdgeKind, FlowEvent, PayerFlow, WalletEdge } from "./api";

const EPS = 0.01;

export function buildCoverage(input: Omit<Coverage, "unexplained">): Coverage {
  return {
    ...input,
    unexplained: input.received - input.sent - input.held,
  };
}

export function qualityLevel(coverage: Coverage): "ok" | "warn" {
  if (Math.abs(coverage.unexplained) >= EPS) return "warn";
  if (coverage.truncated) return "warn";
  if (coverage.peersSkipped > 0) return "warn";
  if (coverage.rateLimits > 0) return "warn";
  if (
    coverage.facilitatorSettles != null &&
    coverage.facilitatorSettles !== coverage.x402OnChain
  ) {
    return "warn";
  }
  return "ok";
}

function visibleAt(event: FlowEvent, until: number): boolean {
  return !event.time || event.time <= until;
}

function emptyFlow(address: string, time: number): PayerFlow {
  return { address, settles: 0, usdc: 0, x402: 0, first: time, last: time };
}

function bumpFlow(
  map: Map<string, PayerFlow>,
  address: string,
  amount: number,
  time: number,
  isX402: boolean,
) {
  const row = map.get(address) ?? emptyFlow(address, time);
  row.settles += 1;
  row.usdc += amount;
  if (isX402) row.x402 += 1;
  row.first = Math.min(row.first || time, time);
  row.last = Math.max(row.last, time);
  map.set(address, row);
}

function bumpEdge(
  map: Map<string, WalletEdge>,
  from: string,
  to: string,
  amount: number,
  time: number,
  isX402: boolean,
  kind: EdgeKind,
) {
  const key = `${from}>${to}`;
  const row = map.get(key) ?? {
    from,
    to,
    usdc: 0,
    settles: 0,
    x402: 0,
    kind,
    first: time,
    last: time,
  };
  row.usdc += amount;
  row.settles += 1;
  if (isX402) row.x402 += 1;
  row.first = Math.min(row.first || time, time);
  row.last = Math.max(row.last, time);
  map.set(key, row);
}

export function rollupEvents(hub: string, events: FlowEvent[]) {
  const payerMap = new Map<string, PayerFlow>();
  const payeeMap = new Map<string, PayerFlow>();
  const edgeMap = new Map<string, WalletEdge>();
  let incoming = 0;
  let x402 = 0;
  let outboundUsdc = 0;
  let outboundTx = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const event of events) {
    if (event.time) {
      first = first == null ? event.time : Math.min(first, event.time);
      last = last == null ? event.time : Math.max(last, event.time);
    }
    bumpEdge(edgeMap, event.from, event.to, event.usdc, event.time, event.x402, event.kind);
    if (event.kind === "in") {
      incoming += 1;
      if (event.x402) x402 += 1;
      if (event.from !== hub) {
        bumpFlow(payerMap, event.from, event.usdc, event.time, event.x402);
      }
    } else if (event.kind === "out") {
      outboundTx += 1;
      outboundUsdc += event.usdc;
      if (event.to !== hub) {
        bumpFlow(payeeMap, event.to, event.usdc, event.time, event.x402);
      }
    }
  }

  return {
    payers: [...payerMap.values()].sort((a, b) => b.usdc - a.usdc),
    payees: [...payeeMap.values()].sort((a, b) => b.usdc - a.usdc),
    edges: [...edgeMap.values()].sort((a, b) => b.usdc - a.usdc),
    incoming,
    x402,
    outboundUsdc,
    outboundTx,
    first,
    last,
  };
}

export function sliceAnalysis(analysis: Analysis, until: number): Analysis {
  const events = analysis.events.filter((event) => visibleAt(event, until));
  return {
    ...analysis,
    events,
    ...rollupEvents(analysis.address, events),
  };
}

export type Dossier = {
  address: string;
  role: "payTo" | "payer" | "payee" | "both" | "peer";
  first: number | null;
  last: number | null;
  volumeIn: number;
  volumeOut: number;
  settles: number;
  x402: number;
  tickets: { amount: number; count: number }[];
  held: number | null;
};

export type Finding = {
  id: string;
  kind: "new_payer" | "bot_ticket" | "first_outbound" | "hour_spike" | "facilitator_mismatch";
  title: string;
  detail: string;
  address?: string;
  time?: number;
};

const DAY = 86_400;

function ticketKey(amount: number): number {
  return Math.round(amount * 1e6) / 1e6;
}

function countTickets(amounts: number[]): { amount: number; count: number }[] {
  const map = new Map<number, number>();
  for (const amount of amounts) {
    const key = ticketKey(amount);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([amount, count]) => ({ amount, count }))
    .sort((a, b) => a.amount - b.amount);
}

export function dossierFor(analysis: Analysis, address: string): Dossier {
  const hub = analysis.address;
  const mine = analysis.events.filter((event) => event.from === address || event.to === address);
  let first: number | null = null;
  let last: number | null = null;
  let volumeIn = 0;
  let volumeOut = 0;
  let settles = 0;
  let x402 = 0;
  const paid = new Set<string>();
  const received = new Set<string>();
  const ticketAmounts: number[] = [];

  for (const event of mine) {
    if (event.time) {
      first = first == null ? event.time : Math.min(first, event.time);
      last = last == null ? event.time : Math.max(last, event.time);
    }
    settles += 1;
    if (event.x402) x402 += 1;
    if (address === hub) {
      if (event.kind === "in") {
        volumeIn += event.usdc;
        ticketAmounts.push(event.usdc);
      }
      if (event.kind === "out") volumeOut += event.usdc;
    } else {
      if (event.kind === "in" && event.from === address) {
        volumeIn += event.usdc;
        paid.add(hub);
        ticketAmounts.push(event.usdc);
      }
      if (event.kind === "out" && event.to === address) {
        volumeOut += event.usdc;
        received.add(hub);
      }
      if (event.kind === "peer" && event.from === address) paid.add(event.to);
      if (event.kind === "peer" && event.to === address) received.add(event.from);
    }
  }

  let role: Dossier["role"] = "peer";
  if (address === hub) role = "payTo";
  else if (paid.has(hub) && received.has(hub)) role = "both";
  else if (paid.has(hub)) role = "payer";
  else if (received.has(hub)) role = "payee";

  return {
    address,
    role,
    first,
    last,
    volumeIn,
    volumeOut,
    settles,
    x402,
    tickets: countTickets(ticketAmounts),
    held: address === hub ? (analysis.account?.usdc ?? null) : null,
  };
}

export function findAnomalies(analysis: Analysis): Finding[] {
  const hits: Finding[] = [];
  const clock =
    analysis.last ??
    analysis.events.reduce<number | null>((max, event) => {
      if (!event.time) return max;
      return max == null ? event.time : Math.max(max, event.time);
    }, null);

  if (clock) {
    for (const payer of analysis.payers) {
      if (payer.first && payer.first >= clock - DAY) {
        hits.push({
          id: `new_payer:${payer.address}`,
          kind: "new_payer",
          title: "New payer",
          detail: "First seen in the last day of this window",
          address: payer.address,
          time: payer.first,
        });
      }
    }
  }

  const inbound = analysis.events.filter((event) => event.kind === "in");
  const tickets = countTickets(inbound.map((event) => event.usdc));
  const top = tickets.reduce<(typeof tickets)[0] | null>(
    (best, row) => (!best || row.count > best.count ? row : best),
    null,
  );
  if (
    top &&
    inbound.length >= 5 &&
    (top.count >= 8 || top.count / inbound.length >= 0.7)
  ) {
    hits.push({
      id: `bot_ticket:${top.amount}`,
      kind: "bot_ticket",
      title: "Repeated ticket",
      detail: `${top.count} settles at $${top.amount.toFixed(top.amount < 0.01 ? 4 : 2)}`,
      address: analysis.payers.find((row) =>
        analysis.events.some(
          (event) =>
            event.kind === "in" &&
            event.from === row.address &&
            ticketKey(event.usdc) === top.amount,
        ),
      )?.address,
    });
  }

  const firstIn = inbound.filter((event) => event.time).sort((a, b) => a.time - b.time)[0];
  const firstOut = analysis.events
    .filter((event) => event.kind === "out" && event.time)
    .sort((a, b) => a.time - b.time)[0];
  if (firstIn && firstOut && firstOut.time > firstIn.time) {
    hits.push({
      id: `first_outbound:${firstOut.to}`,
      kind: "first_outbound",
      title: "First outbound",
      detail: "PayTo sent USDC after it had already been paid",
      address: firstOut.to,
      time: firstOut.time,
    });
  }

  const hours = analysis.hours.filter((slot) => slot.usdc > 0);
  const total = hours.reduce((sum, slot) => sum + slot.usdc, 0);
  const mean = hours.length ? total / hours.length : 0;
  const spike = hours.find((slot) => {
    if (total <= 0) return false;
    const share = slot.usdc / total;
    return share >= 0.4 || (mean > 0 && slot.usdc >= mean * 3 && share >= 0.25);
  });
  if (spike) {
    hits.push({
      id: `hour_spike:${spike.hour}`,
      kind: "hour_spike",
      title: "Hour spike",
      detail: `${String(spike.hour).padStart(2, "0")}:00 UTC took ${((spike.usdc / total) * 100).toFixed(0)}% of inbound`,
      time: clock ?? undefined,
    });
  }

  const fac = analysis.coverage.facilitatorSettles;
  if (fac != null && fac !== analysis.coverage.x402OnChain) {
    hits.push({
      id: "facilitator_mismatch",
      kind: "facilitator_mismatch",
      title: "Facilitator mismatch",
      detail: `${analysis.coverage.x402OnChain} on-chain x402 vs ${fac} listed`,
    });
  }

  return hits;
}
