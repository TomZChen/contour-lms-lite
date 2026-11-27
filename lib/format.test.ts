import { describe, expect, it } from "vitest";
import { dayKey, formatDateTime, formatTime } from "./format";

// Vitest runs these with TZ=America/Los_Angeles (see vitest.config.mts), so
// they only pass if formatting uses Melbourne time explicitly.
describe("formatting in Melbourne time", () => {
  it("labels summer times AEDT and winter times AEST", () => {
    expect(formatDateTime("2026-11-25T23:00:00Z")).toMatch(/Thu.*26 Nov 2026.*10:00.*am.*AEDT/);
    expect(formatDateTime("2026-06-15T00:00:00Z")).toMatch(/Mon.*15 June? 2026.*10:00.*am.*AEST/);
  });

  it("groups by the Melbourne date, not the machine's", () => {
    // 10:00 Thursday in Melbourne is still Wednesday in Los Angeles.
    expect(dayKey("2026-11-25T23:00:00Z")).toBe("2026-11-26");
    expect(formatTime("2026-11-25T23:00:00Z")).toMatch(/10:00.*am/);
  });
});
