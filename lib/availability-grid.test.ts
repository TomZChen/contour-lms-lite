import { describe, expect, it } from "vitest";
import { cellKey, cellsToWindows, sameCells, windowsToCells } from "./availability-grid";

const cells = (...pairs: [number, number][]) => new Set(pairs.map(([d, h]) => cellKey(d, h)));

describe("cellsToWindows", () => {
  it("returns no windows for an empty grid", () => {
    expect(cellsToWindows(new Set())).toEqual([]);
  });

  it("merges consecutive hours into one window and splits at gaps", () => {
    expect(cellsToWindows(cells([1, 9], [1, 10], [1, 11], [1, 14]))).toEqual([
      { weekday: 1, start: "09:00", end: "12:00" },
      { weekday: 1, start: "14:00", end: "15:00" },
    ]);
  });

  it("handles the first and last hours of the business day", () => {
    expect(cellsToWindows(cells([7, 8], [7, 19]))).toEqual([
      { weekday: 7, start: "08:00", end: "09:00" },
      { weekday: 7, start: "19:00", end: "20:00" },
    ]);
  });

  it("orders windows Monday first, regardless of insertion order", () => {
    const w = cellsToWindows(cells([5, 9], [2, 9], [1, 9]));
    expect(w.map((x) => x.weekday)).toEqual([1, 2, 5]);
  });

  it("never merges across days", () => {
    expect(cellsToWindows(cells([1, 19], [2, 8]))).toHaveLength(2);
  });
});

describe("windowsToCells", () => {
  it("expands windows to one cell per hour", () => {
    expect(windowsToCells([{ weekday: 3, start: "10:00", end: "13:00" }])).toEqual(cells([3, 10], [3, 11], [3, 12]));
  });

  it("round-trips with cellsToWindows (adjacent windows are normalised into one)", () => {
    const windows = [
      { weekday: 1, start: "08:00", end: "12:00" },
      { weekday: 1, start: "12:00", end: "13:00" },
      { weekday: 6, start: "15:00", end: "20:00" },
    ];
    expect(cellsToWindows(windowsToCells(windows))).toEqual([
      { weekday: 1, start: "08:00", end: "13:00" },
      { weekday: 6, start: "15:00", end: "20:00" },
    ]);
  });
});

describe("sameCells", () => {
  it("compares by content, not identity or order", () => {
    expect(sameCells(cells([1, 9], [2, 9]), cells([2, 9], [1, 9]))).toBe(true);
    expect(sameCells(cells([1, 9]), cells([1, 10]))).toBe(false);
    expect(sameCells(cells([1, 9]), cells([1, 9], [1, 10]))).toBe(false);
  });
});
