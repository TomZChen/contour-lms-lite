import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Stable, machine-readable error codes returned by every API route as
 * `{ error: { code, message, details? } }`. Clients branch on `code`; the
 * message is for humans.
 */
export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "csrf_rejected"
  | "not_found"
  | "invalid_json"
  | "unsupported_media_type"
  | "validation_failed"
  | "invalid_range"
  | "slot_taken"
  | "slot_in_past"
  | "slot_not_on_the_hour"
  | "tutor_unavailable"
  | "tutor_not_in_subject"
  | "consultation_cancelled"
  | "consultation_completed"
  | "consultation_not_ended"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Messages raised by the booking trigger (see migration, D23). */
const BOOKING_RULE_ERRORS: Record<string, [ApiErrorCode, string]> = {
  slot_in_past: ["slot_in_past", "Consultations must be booked in the future."],
  slot_not_on_the_hour: ["slot_not_on_the_hour", "Consultations start on the hour."],
  tutor_unavailable: ["tutor_unavailable", "The tutor does not work at the selected time."],
  invalid_range: ["invalid_range", "The requested time range is invalid."],
};

/**
 * Translate a database error into an API error. The database is the final
 * authority on business rules (D23); this keeps its answers consistent and
 * never leaks raw SQL errors to clients.
 */
export function fromPostgrestError(error: PostgrestError): ApiError {
  switch (error.code) {
    case "P0001": {
      const known = BOOKING_RULE_ERRORS[error.message];
      if (known) return new ApiError(422, known[0], known[1]);
      break;
    }
    case "23P01": // exclusion constraint: overlapping booking
      return new ApiError(
        409,
        "slot_taken",
        error.message.includes("student_overlap")
          ? "You already have a consultation at that time."
          : "That tutor has just been booked at that time. Please choose another slot or tutor.",
      );
    case "23503": // foreign key: tutor does not teach the subject / unknown ids
      return new ApiError(422, "tutor_not_in_subject", "The selected tutor does not teach that subject.");
    case "23514": // check constraint
      return new ApiError(422, "validation_failed", "The request violates a data constraint.");
    case "42501": // RLS / privilege
      return new ApiError(403, "forbidden", "You are not allowed to perform this action.");
    case "PGRST116": // .single() found no row (missing or hidden by RLS)
      return new ApiError(404, "not_found", "Not found.");
  }
  console.error("Unmapped database error", error);
  return new ApiError(500, "internal_error", "Something went wrong.");
}

export const notFound = (what = "Resource") =>
  new ApiError(404, "not_found", `${what} not found.`);
