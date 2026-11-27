import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ApiError, fromPostgrestError } from "./errors";

const pg = (code: string, message = "", details = ""): PostgrestError =>
  ({ code, message, details, hint: "", name: "PostgrestError" }) as PostgrestError;

describe("fromPostgrestError", () => {
  it.each([
    ["slot_in_past", "slot_in_past"],
    ["slot_not_on_the_hour", "slot_not_on_the_hour"],
    ["tutor_unavailable", "tutor_unavailable"],
  ])("maps booking-trigger error %s to 422", (message, code) => {
    expect(fromPostgrestError(pg("P0001", message))).toMatchObject({ status: 422, code });
  });

  it("maps availability_conflict to 409 with the sessions from the error detail", () => {
    const conflicts = [{ id: "c1", scheduledAt: "2026-12-01T00:00:00+00:00" }];
    const e = fromPostgrestError(pg("P0001", "availability_conflict", JSON.stringify(conflicts)));
    expect(e).toMatchObject({ status: 409, code: "availability_conflict", details: { conflicts } });
  });

  it("survives a malformed availability_conflict detail", () => {
    expect(fromPostgrestError(pg("P0001", "availability_conflict", "{oops")).details).toEqual({ conflicts: [] });
  });

  it("maps exclusion violations: a tutor clash, a student clash, and overlapping availability", () => {
    expect(fromPostgrestError(pg("23P01", 'violates "consultations_no_tutor_overlap"'))).toMatchObject({ status: 409, code: "slot_taken" });
    expect(fromPostgrestError(pg("23P01", 'violates "consultations_no_student_overlap"')).message).toMatch(/You already have/);
    expect(fromPostgrestError(pg("23P01", 'violates "tutor_availability_no_overlap"'))).toMatchObject({ status: 422, code: "validation_failed" });
  });

  it.each([
    ["23503", 422, "tutor_not_in_subject"],
    ["23514", 422, "validation_failed"],
    ["42501", 403, "forbidden"],
    ["PGRST116", 404, "not_found"],
  ])("maps %s to %i %s", (pgCode, status, code) => {
    expect(fromPostgrestError(pg(pgCode))).toMatchObject({ status, code });
  });

  it("hides unknown database errors behind a generic 500", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = fromPostgrestError(pg("XX000", "relation secret_table does not exist"));
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 500, code: "internal_error", message: "Something went wrong." });
    expect(e.message).not.toMatch(/secret_table/);
    expect(log).toHaveBeenCalled(); // logged server-side for debugging
    log.mockRestore();
  });
});
