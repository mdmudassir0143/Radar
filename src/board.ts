export type BoardItem = {
  rank: number;
  id: string;
  label: string;
  sub: string | null;
  logo: string | null;
  address: string | null;
  volume: number;
  settles: number;
  delta: number | null;
  bazaar?: boolean;
  challenge?: boolean;
  blocked?: { reason?: string } | null;
};

export type BoardSnap = {
  range: string;
  total: number;
  items: BoardItem[];
};

export type SparkPoint = {
  t: number;
  volume: number;
  settles: number;
};

export type TeamRow = {
  id: string;
  name: string;
  host: string;
  address: string | null;
  logo: string | null;
  blocked: string | null;
  rankAll: number;
  rank30: number | null;
  rank7: number | null;
  rank24: number | null;
  volAll: number;
  vol30: number;
  vol7: number;
  vol24: number;
  settlesAll: number;
  settles30: number;
  settles7: number;
  settles24: number;
  climb7: number | null;
  climb24: number | null;
  delta24: number | null;
  sparkline: SparkPoint[];
  avgTicket: number | null;
  payers: number | null;
};

type SparkCarrier = {
  id: string;
  name: string;
  sparkline: SparkPoint[];
};

export function teamName(label: string): string {
  const cut = label.split("—")[0].split(" - ")[0].trim();
  return cut.length > 28 ? `${cut.slice(0, 26)}…` : cut;
}

function indexById(snap: BoardSnap): Map<string, BoardItem> {
  return new Map(snap.items.map((item) => [item.id, item]));
}

export function mergeBoards(
  all: BoardSnap,
  month: BoardSnap,
  week: BoardSnap,
  day: BoardSnap,
): TeamRow[] {
  const monthMap = indexById(month);
  const weekMap = indexById(week);
  const dayMap = indexById(day);
  return all.items
    .map((item) => {
      const m = monthMap.get(item.id);
      const w = weekMap.get(item.id);
      const d = dayMap.get(item.id);
      return {
        id: item.id,
        name: teamName(item.label),
        host: item.sub ?? "",
        address: item.address,
        logo: item.logo,
        blocked: item.blocked?.reason ?? null,
        rankAll: item.rank,
        rank30: m?.rank ?? null,
        rank7: w?.rank ?? null,
        rank24: d?.rank ?? null,
        volAll: item.volume,
        vol30: m?.volume ?? 0,
        vol7: w?.volume ?? 0,
        vol24: d?.volume ?? 0,
        settlesAll: item.settles,
        settles30: m?.settles ?? 0,
        settles7: w?.settles ?? 0,
        settles24: d?.settles ?? 0,
        climb7: w ? item.rank - w.rank : null,
        climb24: d ? item.rank - d.rank : null,
        delta24: d?.delta ?? null,
        sparkline: [],
        avgTicket: item.settles ? item.volume / item.settles : null,
        payers: null,
      };
    })
    .sort((a, b) => a.rankAll - b.rankAll);
}

export function attachSparks(
  rows: TeamRow[],
  sparks: Record<string, { sparkline: SparkPoint[]; avgTicket?: number; payers?: number }>,
): TeamRow[] {
  return rows.map((row) => {
    const extra = sparks[row.id];
    if (!extra) return row;
    return {
      ...row,
      sparkline: extra.sparkline,
      avgTicket: extra.avgTicket ?? row.avgTicket,
      payers: extra.payers ?? row.payers,
    };
  });
}

export function alignSparks(
  rows: SparkCarrier[],
  limit = 8,
): { labels: string[]; series: { id: string; name: string; values: (number | null)[] }[] } {
  const top = rows.slice(0, limit);
  const times = [...new Set(top.flatMap((row) => row.sparkline.map((point) => point.t)))].sort(
    (a, b) => a - b,
  );
  const labels = times.map((t) => {
    const d = new Date(t > 1e12 ? t : t * 1000);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
  const series = top.map((row) => {
    const byTime = new Map(row.sparkline.map((point) => [point.t, point.volume]));
    return {
      id: row.id,
      name: row.name,
      values: times.map((t) => (byTime.has(t) ? (byTime.get(t) ?? 0) : null)),
    };
  });
  return { labels, series };
}

export function boardTotals(rows: TeamRow[]) {
  return {
    teams: rows.length,
    volAll: rows.reduce((sum, row) => sum + row.volAll, 0),
    vol24: rows.reduce((sum, row) => sum + row.vol24, 0),
    vol7: rows.reduce((sum, row) => sum + row.vol7, 0),
    climbing: rows.filter((row) => (row.climb24 ?? 0) > 0).length,
    falling: rows.filter((row) => (row.climb24 ?? 0) < 0).length,
    blocked: rows.filter((row) => row.blocked).length,
  };
}
