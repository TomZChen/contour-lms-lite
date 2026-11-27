import type { AvailabilityWindowDto } from "@/lib/dto";
import { BUSINESS_CLOSE_HOUR, BUSINESS_OPEN_HOUR } from "@/lib/validation";

/*
 * Conversion between the availability editor's grid of hour cells and the
 * windows the API stores (D46). Pure, so it is unit-tested.
 */

export const WEEKDAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;

/** Start hour of every bookable hour of the day (08 … 19). */
export const HOURS = Array.from({ length: BUSINESS_CLOSE_HOUR - BUSINESS_OPEN_HOUR }, (_, i) => BUSINESS_OPEN_HOUR + i);

/** A cell is one bookable hour of the week: "weekday-hour". */
export const cellKey = (weekday: number, hour: number) => `${weekday}-${hour}`;

const pad = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function windowsToCells(windows: AvailabilityWindowDto[]): Set<string> {
  const cells = new Set<string>();
  for (const w of windows) {
    for (let h = Number(w.start.slice(0, 2)); h < Number(w.end.slice(0, 2)); h++) cells.add(cellKey(w.weekday, h));
  }
  return cells;
}

/** Merge each day's switched-on hours into contiguous windows, Monday first. */
export function cellsToWindows(cells: Set<string>): AvailabilityWindowDto[] {
  const windows: AvailabilityWindowDto[] = [];
  for (const [weekday] of WEEKDAYS) {
    let start: number | null = null;
    for (const h of [...HOURS, BUSINESS_CLOSE_HOUR]) {
      const on = h < BUSINESS_CLOSE_HOUR && cells.has(cellKey(weekday, h));
      if (on && start === null) start = h;
      if (!on && start !== null) {
        windows.push({ weekday, start: pad(start), end: pad(h) });
        start = null;
      }
    }
  }
  return windows;
}

export const sameCells = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((k) => b.has(k));
