import { describe, expect, it } from "vitest";
import { alignSparks, mergeBoards, type BoardSnap } from "./board";

function snap(
  range: string,
  items: { id: string; rank: number; volume: number; settles?: number; label?: string }[],
): BoardSnap {
  return {
    range,
    total: items.length,
    items: items.map((item) => ({
      rank: item.rank,
      id: item.id,
      label: item.label ?? item.id,
      sub: `${item.id}.app`,
      logo: null,
      address: "A".repeat(58),
      volume: item.volume,
      settles: item.settles ?? 10,
      delta: null,
      bazaar: true,
      challenge: true,
      blocked: null,
    })),
  };
}

describe("mergeBoards", () => {
  it("marks a team as climbing when 24h rank is better than all-time", () => {
    const rows = mergeBoards(
      snap("all", [
        { id: "slow", rank: 1, volume: 900 },
        { id: "hot", rank: 8, volume: 80 },
      ]),
      snap("30d", [{ id: "hot", rank: 3, volume: 70 }]),
      snap("7d", [{ id: "hot", rank: 2, volume: 40 }]),
      snap("24h", [{ id: "hot", rank: 1, volume: 25 }]),
    );
    const hot = rows.find((row) => row.id === "hot");
    expect(hot?.climb24).toBe(7);
    expect(hot?.climb7).toBe(6);
    expect(hot?.vol24).toBe(25);
    expect(hot?.rankAll).toBe(8);
  });

  it("leaves climb empty when a team is missing from the recent board", () => {
    const rows = mergeBoards(
      snap("all", [{ id: "old", rank: 1, volume: 500 }]),
      snap("30d", []),
      snap("7d", []),
      snap("24h", []),
    );
    expect(rows[0].climb24).toBeNull();
    expect(rows[0].vol24).toBe(0);
    expect(rows[0].rank24).toBeNull();
  });
});

describe("alignSparks", () => {
  it("lines teams up on the same days and leaves missing volume empty", () => {
    const chart = alignSparks([
      {
        id: "a",
        name: "Alpha",
        sparkline: [
          { t: 1_000, volume: 10, settles: 1 },
          { t: 3_000, volume: 30, settles: 1 },
        ],
      },
      {
        id: "b",
        name: "Beta",
        sparkline: [{ t: 2_000, volume: 20, settles: 1 }],
      },
    ]);
    expect(chart.labels).toHaveLength(3);
    expect(chart.series[0].values).toEqual([10, null, 30]);
    expect(chart.series[1].values).toEqual([null, 20, null]);
  });
});
