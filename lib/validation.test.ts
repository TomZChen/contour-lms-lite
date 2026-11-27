import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adminListConsultationsQuery,
  availabilityQuery,
  createConsultationSchema,
  nameSearch,
  rescheduleSchema,
  setAvailabilitySchema,
  slotStart,
} from "./validation";

const NOW = new Date("2026-11-27T01:30:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

const booking = {
  firstName: "Sam",
  lastName: "Student",
  reason: "Exam revision",
  scheduledAt: "2026-11-28T00:00:00Z",
  subjectId: "11111111-1111-1111-1111-111111111111",
  tutorId: "33333333-3333-3333-3333-333333333333",
};

describe("slotStart", () => {
  it("accepts a future time on the hour, with any offset", () => {
    expect(slotStart.safeParse("2026-11-28T00:00:00Z").success).toBe(true);
    expect(slotStart.safeParse("2026-11-28T11:00:00+11:00").success).toBe(true);
  });

  it.each([
    ["2026-11-27T01:00:00Z", "in the past"],
    ["2026-11-28T00:30:00Z", "not on the hour"],
    ["2026-11-28T00:00:01Z", "stray seconds"],
    ["2026-11-28T00:00:00", "no offset (ambiguous wall-clock time)"],
    ["tomorrow", "not a datetime"],
  ])("rejects %s (%s)", (value, why) => {
    expect(slotStart.safeParse(value).success, why).toBe(false);
  });
});

describe("createConsultationSchema", () => {
  it("accepts the booking form and trims names", () => {
    const r = createConsultationSchema.parse({ ...booking, firstName: "  Sam " });
    expect(r.firstName).toBe("Sam");
  });

  it("rejects unknown fields, so studentId can't be smuggled in", () => {
    expect(createConsultationSchema.safeParse({ ...booking, studentId: booking.tutorId }).success).toBe(false);
  });

  it.each([
    [{ firstName: "   " }, "blank first name"],
    [{ lastName: "x".repeat(101) }, "name over 100 characters"],
    [{ reason: "x".repeat(1001) }, "reason over 1000 characters"],
    [{ tutorId: "not-a-uuid" }, "bad tutor id"],
  ])("rejects %o (%s)", (patch, why) => {
    expect(createConsultationSchema.safeParse({ ...booking, ...patch }).success, why).toBe(false);
  });

  it("accepts the seed's non-RFC uuids (why it uses z.guid)", () => {
    expect(createConsultationSchema.safeParse({ ...booking, tutorId: "22222222-2222-2222-2222-222222222222" }).success).toBe(true);
  });
});

describe("rescheduleSchema", () => {
  it("allows an optional new tutor but nothing else", () => {
    expect(rescheduleSchema.safeParse({ scheduledAt: booking.scheduledAt }).success).toBe(true);
    expect(rescheduleSchema.safeParse({ scheduledAt: booking.scheduledAt, tutorId: booking.tutorId }).success).toBe(true);
    expect(rescheduleSchema.safeParse({ scheduledAt: booking.scheduledAt, subjectId: booking.subjectId }).success).toBe(false);
  });
});

describe("nameSearch (admin q)", () => {
  it("trims and collapses whitespace; empty means no filter", () => {
    expect(nameSearch.parse("  sam   student ")).toBe("sam student");
    expect(nameSearch.parse("   ")).toBeUndefined();
  });

  it("accepts real-world names", () => {
    for (const n of ["O'Brien", "Jean-Luc", "St. John", "Zoë Nguyễn", "李"]) expect(nameSearch.safeParse(n).success).toBe(true);
  });

  it.each([
    ['a",id.neq.x', "quote and comma (PostgREST filter syntax)"],
    ["a)", "closing parenthesis"],
    ["50%", "LIKE wildcard %"],
    ["a_b", "LIKE wildcard _"],
    ["a*", "PostgREST wildcard *"],
    ["x".repeat(101), "too long"],
  ])("rejects %s (%s)", (value, why) => {
    expect(nameSearch.safeParse(value).success, why).toBe(false);
  });
});

describe("adminListConsultationsQuery", () => {
  it("coerces limit from the query string and applies defaults", () => {
    expect(adminListConsultationsQuery.parse({ limit: "50" })).toMatchObject({ limit: 50, order: "asc" });
    expect(adminListConsultationsQuery.parse({})).toMatchObject({ limit: 20 });
  });

  it("caps the page size and rejects unknown params", () => {
    expect(adminListConsultationsQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(adminListConsultationsQuery.safeParse({ select: "*" }).success).toBe(false);
  });
});

describe("availabilityQuery", () => {
  it("defaults to the next 14 days", () => {
    const q = availabilityQuery.parse({});
    expect(q.from.getTime()).toBe(NOW.getTime());
    expect((q.to.getTime() - q.from.getTime()) / 86_400_000).toBe(14);
  });

  it("rejects backwards ranges and ranges over 31 days", () => {
    expect(availabilityQuery.safeParse({ from: "2026-12-10T00:00:00Z", to: "2026-12-01T00:00:00Z" }).success).toBe(false);
    expect(availabilityQuery.safeParse({ from: "2026-12-01T00:00:00Z", to: "2027-01-02T00:00:00Z" }).success).toBe(false);
  });
});

describe("setAvailabilitySchema", () => {
  const ok = (windows: unknown[]) => setAvailabilitySchema.safeParse({ windows }).success;

  it("accepts an empty week and adjacent windows", () => {
    expect(ok([])).toBe(true);
    expect(ok([{ weekday: 1, start: "08:00", end: "12:00" }, { weekday: 1, start: "12:00", end: "20:00" }])).toBe(true);
  });

  it("allows the same hours on different days", () => {
    expect(ok([{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 2, start: "09:00", end: "12:00" }])).toBe(true);
  });

  it.each([
    [[{ weekday: 1, start: "09:00", end: "12:00" }, { weekday: 1, start: "11:00", end: "13:00" }], "overlap on one day"],
    [[{ weekday: 1, start: "07:00", end: "09:00" }], "before opening"],
    [[{ weekday: 1, start: "19:00", end: "21:00" }], "after closing"],
    [[{ weekday: 1, start: "09:30", end: "11:00" }], "not on the hour"],
    [[{ weekday: 1, start: "12:00", end: "12:00" }], "empty window"],
    [[{ weekday: 8, start: "09:00", end: "10:00" }], "bad weekday"],
    [[{ weekday: 1, start: "09:00", end: "10:00", tutorId: "x" }], "extra field"],
  ])("rejects %j (%s)", (windows, why) => {
    expect(ok(windows), why).toBe(false);
  });
});
