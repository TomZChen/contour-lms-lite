import { describe, expect, it } from "vitest";
import { addDays, isDateKey, localParts, startOfWeek, weekdayOf, weekRange, zonedTime } from "./calendar";

// Melbourne: AEDT (UTC+11) in summer, AEST (UTC+10) in winter.
// 2026 transitions: DST ends Sun 5 Apr 03:00 → 02:00; starts Sun 4 Oct 02:00 → 03:00.

describe("zonedTime", () => {
  it.each([
    ["2026-11-26", 10, "2026-11-25T23:00:00.000Z", "summer (AEDT)"],
    ["2026-06-15", 10, "2026-06-15T00:00:00.000Z", "winter (AEST)"],
    ["2026-04-05", 0, "2026-04-04T13:00:00.000Z", "midnight on the day DST ends (still AEDT)"],
    ["2026-04-05", 10, "2026-04-05T00:00:00.000Z", "after DST ends"],
    ["2026-10-04", 0, "2026-10-03T14:00:00.000Z", "midnight on the day DST starts (still AEST)"],
    ["2026-10-04", 10, "2026-10-03T23:00:00.000Z", "after DST starts"],
  ])("%s %i:00 Melbourne is %s (%s)", (key, hour, iso) => {
    expect(zonedTime(key, hour).toISOString()).toBe(iso);
  });

  it("round-trips through localParts for every business hour of a DST week", () => {
    for (let d = 0; d < 7; d++) {
      const key = addDays("2026-09-28", d);
      for (let h = 8; h < 20; h++) {
        expect(localParts(zonedTime(key, h))).toMatchObject({ dateKey: key, hour: h, minute: 0 });
      }
    }
  });
});

describe("localParts", () => {
  it("returns the Melbourne date, ISO weekday and hour", () => {
    expect(localParts("2026-11-25T23:00:00Z")).toEqual({ dateKey: "2026-11-26", weekday: 4, hour: 10, minute: 0 });
  });

  it("rolls over to the next Melbourne day before UTC does", () => {
    expect(localParts("2026-11-29T13:30:00Z")).toMatchObject({ dateKey: "2026-11-30", weekday: 1, hour: 0 });
  });
});

describe("date keys", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-29", 7)).toBe("2027-01-05");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("finds the ISO weekday and the week's Monday", () => {
    expect(weekdayOf("2026-11-23")).toBe(1);
    expect(weekdayOf("2026-11-29")).toBe(7);
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-26")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-29")).toBe("2026-11-23");
  });

  it("validates keys strictly", () => {
    expect(isDateKey("2026-02-28")).toBe(true);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-2-28")).toBe(false);
    expect(isDateKey("bogus")).toBe(false);
  });
});

describe("weekRange", () => {
  it("covers Monday 00:00 to the next Monday 00:00, Melbourne time", () => {
    const { days, from, to } = weekRange("2026-11-23");
    expect(days).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    expect(from.toISOString()).toBe("2026-11-22T13:00:00.000Z");
    expect(to.toISOString()).toBe("2026-11-29T13:00:00.000Z");
  });

  it("is 167 hours long in the week DST starts, and 169 in the week it ends", () => {
    const hours = (k: string) => {
      const { from, to } = weekRange(k);
      return (to.getTime() - from.getTime()) / 3_600_000;
    };
    expect(hours("2026-09-28")).toBe(167);
    expect(hours("2026-03-30")).toBe(169);
  });
});
