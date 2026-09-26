import { buildCoverage } from "./telemetry";
import type { BoardSnap, SparkPoint } from "./board";

export const USDC_ASA = 31566704;
export const ADDR_RE = /^[A-Z2-7]{58}$/;

export type PayerFlow = {
  address: string;
  settles: number;
  usdc: number;
  x402: number;
  first: number;
  last: number;
};

export type EdgeKind = "in" | "out" | "peer";

export type WalletEdge = {
  from: string;
  to: string;
  usdc: number;
  settles: number;
  x402: number;
  kind: EdgeKind;
  first: number;
  last: number;
};

export type DailyPoint = {
  day: string;
  usdc: number;
  settles: number;
  outUsdc: number;
  outSettles: number;
};

export type HourPoint = {
  hour: number;
  usdc: number;
  settles: number;
};

export type Ticket = {
  amount: number;
  count: number;
};

export type ResourceRow = {
  path: string;
  method: string;
  price: number;
  settles: number;
  volume: number;
};

export type MerchantHit = {
  id: string;
  rank: number | null;
  name: string;
  host: string;
  address: string;
  volume: number;
  settles: number;
  bazaar: boolean;
  challenge: boolean;
  blocked: string | null;
  payers?: number;
  avgTicket?: number;
  successRate?: number;
  resources: ResourceRow[];
};

export type AccountSnap = {
  algo: number;
  usdc: number;
  minBalance: number;
  optedIn: number;
};

export type FlowEvent = {
  from: string;
  to: string;
  usdc: number;
  time: number;
  x402: boolean;
  kind: EdgeKind;
};

export type Coverage = {
  pages: number;
  lastRound: number | null;
  rateLimits: number;
  peersAsked: number;
  peersSkipped: number;
  x402OnChain: number;
  facilitatorSettles: number | null;
  received: number;
  sent: number;
  held: number;
  unexplained: number;
  truncated: boolean;
};

export type Analysis = {
  address: string;
  account: AccountSnap | null;
  merchant: MerchantHit | null;
  payers: PayerFlow[];
  payees: PayerFlow[];
  edges: WalletEdge[];
  daily: DailyPoint[];
  hours: HourPoint[];
  tickets: Ticket[];
  incoming: number;
  x402: number;
  outboundUsdc: number;
  outboundTx: number;
  scannedPeers: number;
  first: number | null;
  last: number | null;
  events: FlowEvent[];
  coverage: Coverage;
};

export type ChallengeRow = {
  rank: number;
  id: string;
  name: string;
  host: string;
  address: string;
};

function decodeNote(note?: string): string {
  if (!note) return "";
  try {
    return atob(note);
  } catch {
    return "";
  }
}

function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function allo(addr: string): string {
  return `https://allo.info/account/${addr}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PullStats = { rateLimits: number };

async function idx<T>(path: string, stats?: PullStats): Promise<T> {
  let last = "Indexer request failed";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(`/idx${path}`);
    if (res.ok) return res.json() as Promise<T>;
    last = `Indexer ${res.status}`;
    if (res.status === 429 || res.status === 503) {
      if (stats) stats.rateLimits += 1;
    }
    if (res.status !== 429 && res.status !== 503) break;
    await sleep(500 * (attempt + 1) * (attempt + 1));
  }
  throw new Error(last);
}

async function fac<T>(path: string): Promise<T> {
  const res = await fetch(`/fac${path}`);
  if (!res.ok) throw new Error(`Facilitator ${res.status}`);
  return res.json() as Promise<T>;
}

type IdxAccount = {
  account?: {
    amount?: number;
    "min-balance"?: number;
    assets?: { amount: number; "asset-id": number }[];
    "total-assets-opted-in"?: number;
  };
};

type IdxTx = {
  sender: string;
  "round-time"?: number;
  "confirmed-round"?: number;
  note?: string;
  "asset-transfer-transaction"?: {
    receiver?: string;
    amount?: number;
    "asset-id"?: number;
  };
};

type IdxTxPage = {
  transactions?: IdxTx[];
  "next-token"?: string;
};

type LeaderItem = {
  rank: number;
  id: string;
  label: string;
  sub: string | null;
  logo?: string | null;
  address: string | null;
  volume: number;
  settles: number;
  delta?: number | null;
  bazaar?: boolean;
  challenge?: boolean;
  blocked?: { reason?: string } | null;
};

type LeaderPage = {
  items: LeaderItem[];
  total: number;
};

type MerchantDetail = {
  id: string;
  address: string;
  domain?: string;
  site?: { title?: string; siteName?: string };
  volume: number;
  settles: number;
  payers?: number;
  avgTicket?: number;
  successRate?: number;
  bazaar?: boolean;
  challenge?: boolean;
  blocked?: { reason?: string } | null;
  resources?: {
    url: string;
    method: string;
    price: number;
    settles: number;
    volume: number;
  }[];
  sparkline?: SparkPoint[];
};

function toBoardItem(item: LeaderItem) {
  return {
    rank: item.rank,
    id: item.id,
    label: item.label,
    sub: item.sub,
    logo: item.logo ?? null,
    address: item.address,
    volume: item.volume,
    settles: item.settles,
    delta: item.delta ?? null,
    bazaar: item.bazaar,
    challenge: item.challenge,
    blocked: item.blocked ?? null,
  };
}

export async function loadChallengeBoard(range: string): Promise<BoardSnap> {
  const items: BoardSnap["items"] = [];
  let total = 0;
  for (let offset = 0; offset < 400; offset += 50) {
    const qs = new URLSearchParams({
      cat: "merchants",
      limit: "50",
      offset: String(offset),
      range,
      env: "mainnet",
      src: "x402-global-challenge",
    });
    const page = await fac<LeaderPage>(`/data/leaderboards?${qs}`);
    total = page.total ?? items.length;
    items.push(...(page.items ?? []).map(toBoardItem));
    if (!(page.items?.length ?? 0) || (page.items?.length ?? 0) < 50 || items.length >= total) break;
  }
  return { range, total, items };
}

export async function loadMerchantPulses(
  ids: string[],
): Promise<Record<string, { sparkline: SparkPoint[]; avgTicket?: number; payers?: number }>> {
  const out: Record<string, { sparkline: SparkPoint[]; avgTicket?: number; payers?: number }> = {};
  let cursor = 0;
  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      try {
        const detail = await fac<MerchantDetail>(`/data/merchants/${id}`);
        out[id] = {
          sparkline: detail.sparkline ?? [],
          avgTicket: detail.avgTicket,
          payers: detail.payers,
        };
      } catch {
        out[id] = { sparkline: [] };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, ids.length || 1) }, () => worker()));
  return out;
}

export async function loadChallengeHints(): Promise<ChallengeRow[]> {
  const pages = await Promise.all(
    [0, 50, 100].map((offset) =>
      fac<LeaderPage>(
        `/data/leaderboards?cat=merchants&limit=50&offset=${offset}&range=all&env=mainnet&src=x402-global-challenge`,
      ),
    ),
  );
  return pages.flatMap((page) =>
    (page.items ?? [])
      .filter((item) => item.address && ADDR_RE.test(item.address))
      .map((item) => ({
        rank: item.rank,
        id: item.id,
        name: item.label,
        host: item.sub ?? "",
        address: item.address as string,
      })),
  );
}

async function findMerchant(address: string): Promise<MerchantHit | null> {
  const offsets = [0, 50, 100];
  let hit: LeaderItem | null = null;
  for (const source of ["x402-global-challenge", ""]) {
    for (const offset of offsets) {
      const qs = new URLSearchParams({
        cat: "merchants",
        limit: "50",
        offset: String(offset),
        range: "all",
        env: "mainnet",
      });
      if (source) qs.set("src", source);
      const page = await fac<LeaderPage>(`/data/leaderboards?${qs}`);
      const match = page.items.find((item) => item.address === address);
      if (match) {
        hit = match;
        break;
      }
      if ((page.items?.length ?? 0) < 50) break;
    }
    if (hit) break;
  }
  if (!hit) return null;

  let detail: MerchantDetail | null = null;
  try {
    detail = await fac<MerchantDetail>(`/data/merchants/${hit.id}`);
  } catch {
    detail = null;
  }

  return {
    id: hit.id,
    rank: hit.rank,
    name: detail?.site?.siteName || detail?.site?.title || hit.label,
    host: detail?.domain || hit.sub || "",
    address,
    volume: detail?.volume ?? hit.volume,
    settles: detail?.settles ?? hit.settles,
    bazaar: detail?.bazaar ?? Boolean(hit.bazaar),
    challenge: detail?.challenge ?? Boolean(hit.challenge),
    blocked: detail?.blocked?.reason || hit.blocked?.reason || null,
    payers: detail?.payers,
    avgTicket: detail?.avgTicket,
    successRate: detail?.successRate,
    resources: (detail?.resources ?? []).map((row) => ({
      path: shortPath(row.url),
      method: row.method,
      price: row.price,
      settles: row.settles,
      volume: row.volume,
    })),
  };
}

export async function loadAccount(address: string, stats?: PullStats): Promise<AccountSnap | null> {
  try {
    const data = await idx<IdxAccount>(`/v2/accounts/${address}`, stats);
    const acct = data.account;
    if (!acct) return null;
    const usdc =
      acct.assets?.find((asset) => asset["asset-id"] === USDC_ASA)?.amount ?? 0;
    return {
      algo: (acct.amount ?? 0) / 1e6,
      usdc: usdc / 1e6,
      minBalance: (acct["min-balance"] ?? 0) / 1e6,
      optedIn: acct["total-assets-opted-in"] ?? acct.assets?.length ?? 0,
    };
  } catch {
    return null;
  }
}

async function loadTransfers(
  address: string,
  maxPages = 12,
  stats?: PullStats,
): Promise<{
  txs: IdxTx[];
  pages: number;
  truncated: boolean;
  lastRound: number | null;
}> {
  const all: IdxTx[] = [];
  let next: string | undefined;
  let pages = 0;
  let lastRound: number | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const qs = new URLSearchParams({
      "asset-id": String(USDC_ASA),
      "tx-type": "axfer",
      limit: "1000",
    });
    if (next) qs.set("next", next);
    const data = await idx<IdxTxPage>(
      `/v2/accounts/${address}/transactions?${qs}`,
      stats,
    );
    const batch = data.transactions ?? [];
    pages += 1;
    all.push(...batch);
    for (const tx of batch) {
      const round = tx["confirmed-round"];
      if (round) lastRound = lastRound == null ? round : Math.max(lastRound, round);
    }
    next = data["next-token"];
    if (!next || batch.length === 0) break;
  }
  return { txs: all, pages, truncated: Boolean(next), lastRound };
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

async function poolMap<T>(
  items: T[],
  width: number,
  fn: (item: T) => Promise<void>,
) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await fn(item);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, () => worker()),
  );
}

export async function analyzePayTo(
  address: string,
  onPhase?: (message: string) => void,
): Promise<Analysis> {
  if (!ADDR_RE.test(address)) {
    throw new Error("Enter a full 58-character Algorand address.");
  }

  onPhase?.("Reading payTo USDC transfers and merchant listing…");
  const stats: PullStats = { rateLimits: 0 };
  const [account, pull, merchant] = await Promise.all([
    loadAccount(address, stats),
    loadTransfers(address, 12, stats),
    findMerchant(address),
  ]);
  const txs = pull.txs;

  const payerMap = new Map<string, PayerFlow>();
  const payeeMap = new Map<string, PayerFlow>();
  const edgeMap = new Map<string, WalletEdge>();
  const dayMap = new Map<string, DailyPoint>();
  const hourMap = new Map<number, HourPoint>();
  const ticketMap = new Map<number, number>();
  const events: FlowEvent[] = [];

  function dayOf(time: number): DailyPoint {
    const day = new Date(time * 1000).toISOString().slice(0, 10);
    const point = dayMap.get(day) ?? {
      day,
      usdc: 0,
      settles: 0,
      outUsdc: 0,
      outSettles: 0,
    };
    dayMap.set(day, point);
    return point;
  }
  let incoming = 0;
  let x402In = 0;
  let outboundUsdc = 0;
  let outboundTx = 0;
  let first: number | null = null;
  let last: number | null = null;

  for (const tx of txs) {
    const ax = tx["asset-transfer-transaction"];
    if (!ax) continue;
    const raw = ax.amount ?? 0;
    const amount = raw / 1e6;
    const time = tx["round-time"] ?? 0;
    const isX402 = decodeNote(tx.note).startsWith("x402");

    if (ax.receiver === address) {
      incoming += 1;
      if (isX402) x402In += 1;
      if (raw === 0) continue;
      if (time) {
        first = first == null ? time : Math.min(first, time);
        last = last == null ? time : Math.max(last, time);
        const point = dayOf(time);
        point.usdc += amount;
        point.settles += 1;
        const hour = new Date(time * 1000).getUTCHours();
        const slot = hourMap.get(hour) ?? { hour, usdc: 0, settles: 0 };
        slot.usdc += amount;
        slot.settles += 1;
        hourMap.set(hour, slot);
      }
      events.push({ from: tx.sender, to: address, usdc: amount, time, x402: isX402, kind: "in" });
      if (tx.sender !== address) {
        bumpFlow(payerMap, tx.sender, amount, time, isX402);
        bumpEdge(edgeMap, tx.sender, address, amount, time, isX402, "in");
      }
      const ticket = Math.round(amount * 1e6) / 1e6;
      ticketMap.set(ticket, (ticketMap.get(ticket) ?? 0) + 1);
    } else if (tx.sender === address && ax.receiver && ax.receiver !== address) {
      outboundTx += 1;
      if (raw === 0) continue;
      outboundUsdc += amount;
      if (time) {
        first = first == null ? time : Math.min(first, time);
        last = last == null ? time : Math.max(last, time);
        const point = dayOf(time);
        point.outUsdc += amount;
        point.outSettles += 1;
      }
      bumpFlow(payeeMap, ax.receiver, amount, time, isX402);
      bumpEdge(edgeMap, address, ax.receiver, amount, time, isX402, "out");
      events.push({ from: address, to: ax.receiver, usdc: amount, time, x402: isX402, kind: "out" });
    }
  }

  const payers = [...payerMap.values()].sort((a, b) => b.usdc - a.usdc);
  const payees = [...payeeMap.values()].sort((a, b) => b.usdc - a.usdc);

  const cluster = new Set<string>([address]);
  for (const row of payers.slice(0, 20)) cluster.add(row.address);
  for (const row of payees.slice(0, 20)) cluster.add(row.address);
  const peers = [...cluster].filter((wallet) => wallet !== address);

  onPhase?.(
    `Checking USDC between ${peers.length} counterparties (payers, payees, and links)…`,
  );
  let pages = pull.pages;
  let lastRound = pull.lastRound;
  let peersSkipped = 0;
  await poolMap(peers, 3, async (wallet) => {
    try {
      const history = await loadTransfers(wallet, 1, stats);
      pages += history.pages;
      if (history.lastRound != null) {
        lastRound =
          lastRound == null ? history.lastRound : Math.max(lastRound, history.lastRound);
      }
      for (const tx of history.txs) {
        const ax = tx["asset-transfer-transaction"];
        if (!ax?.receiver || tx.sender === ax.receiver) continue;
        const raw = ax.amount ?? 0;
        if (raw === 0) continue;
        if (tx.sender !== wallet) continue;
        if (!cluster.has(ax.receiver)) continue;
        if (tx.sender === address || ax.receiver === address) continue;
        const time = tx["round-time"] ?? 0;
        const isX402 = decodeNote(tx.note).startsWith("x402");
        bumpEdge(
          edgeMap,
          tx.sender,
          ax.receiver,
          raw / 1e6,
          time,
          isX402,
          "peer",
        );
        events.push({
          from: tx.sender,
          to: ax.receiver,
          usdc: raw / 1e6,
          time,
          x402: isX402,
          kind: "peer",
        });
      }
    } catch {
      peersSkipped += 1;
    }
  });

  return {
    address,
    account,
    merchant,
    payers,
    payees,
    edges: [...edgeMap.values()].sort((a, b) => b.usdc - a.usdc),
    daily: [...dayMap.values()].sort((a, b) => a.day.localeCompare(b.day)),
    hours: Array.from({ length: 24 }, (_, hour) => hourMap.get(hour) ?? { hour, usdc: 0, settles: 0 }),
    tickets: [...ticketMap.entries()]
      .map(([amount, count]) => ({ amount, count }))
      .sort((a, b) => a.amount - b.amount),
    incoming,
    x402: x402In,
    outboundUsdc,
    outboundTx,
    scannedPeers: peers.length,
    first,
    last,
    events,
    coverage: buildCoverage({
      pages,
      lastRound,
      rateLimits: stats.rateLimits,
      peersAsked: peers.length,
      peersSkipped,
      x402OnChain: x402In,
      facilitatorSettles: merchant?.settles ?? null,
      received: payers.reduce((sum, row) => sum + row.usdc, 0),
      sent: outboundUsdc,
      held: account?.usdc ?? 0,
      truncated: pull.truncated,
    }),
  };
}
