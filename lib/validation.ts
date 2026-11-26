import { z } from "zod";

/**
 * Request schemas shared by the API routes and the client-side forms, so both
 * sides validate the same way. The database re-checks every rule (D23).
 *
 * `z.guid()` (not `z.uuid()`) accepts any 8-4-4-4-12 hex id. Postgres uuids
 * are not guaranteed to be RFC 4122 v1-v8 (e.g. the seed's fixed ids).
 */
export const id = z.guid();

const isoDateTime = z.iso.datetime({ offset: true });

/** A consultation start time: ISO 8601, on the hour, in the future (D22). */
export const slotStart = isoDateTime
  .refine((s) => {
    const d = new Date(s);
    return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  }, "Consultations start on the hour.")
  .refine((s) => new Date(s).getTime() > Date.now(), "Consultations must be booked in the future.");

const personName = z.string().trim().min(1, "Required.").max(100);

export const createConsultationSchema = z.strictObject({
  firstName: personName,
  lastName: personName,
  reason: z.string().trim().min(1, "Required.").max(1000),
  scheduledAt: slotStart,
  subjectId: id,
  tutorId: id,
});
export type CreateConsultationInput = z.infer<typeof createConsultationSchema>;

export const rescheduleSchema = z.strictObject({
  scheduledAt: slotStart,
  /** Optionally move to another tutor teaching the same subject (D26). */
  tutorId: id.optional(),
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

export const consultationStatus = z.enum(["scheduled", "completed", "cancelled"]);

export const listConsultationsQuery = z.strictObject({
  cursor: z.string().max(512).optional(),
  /** Only sessions starting in [from, to), e.g. one calendar week. */
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: consultationStatus.optional(),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListConsultationsQuery = z.infer<typeof listConsultationsQuery>;

/**
 * Student-name search (admin list). Letters, spaces, apostrophes, hyphens and
 * full stops only, so the words are safe to embed in a PostgREST filter.
 */
export const nameSearch = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\p{L}\p{M}\s'.-]*$/u, "Use letters, spaces, apostrophes or hyphens only.")
  .transform((s) => s.replace(/\s+/g, " ") || undefined);

export const adminListConsultationsQuery = listConsultationsQuery.extend({
  /** Matches the student's first/last name on the booking; every word must match. */
  q: nameSearch.optional(),
  studentId: id.optional(),
  tutorId: id.optional(),
  subjectId: id.optional(),
});
export type AdminListConsultationsQuery = z.infer<typeof adminListConsultationsQuery>;

const MAX_AVAILABILITY_DAYS = 31;
const DEFAULT_AVAILABILITY_DAYS = 14;

export const availabilityQuery = z
  .strictObject({
    from: isoDateTime.optional(),
    to: isoDateTime.optional(),
    /** The tutor the student wants; enables recommendations. */
    tutorId: id.optional(),
    /** The time the student wants; recommends tutors free at that time. */
    at: isoDateTime.optional(),
  })
  .transform((q) => {
    const from = q.from ? new Date(q.from) : new Date();
    const to = q.to
      ? new Date(q.to)
      : new Date(from.getTime() + DEFAULT_AVAILABILITY_DAYS * 86_400_000);
    return { ...q, from, to };
  })
  .refine((q) => q.to > q.from, { message: "`to` must be after `from`.", path: ["to"] })
  .refine((q) => q.to.getTime() - q.from.getTime() <= MAX_AVAILABILITY_DAYS * 86_400_000, {
    message: `The range may span at most ${MAX_AVAILABILITY_DAYS} days.`,
    path: ["to"],
  });
export type AvailabilityQuery = z.infer<typeof availabilityQuery>;

export const idParams = z.object({ id });

// ---------------------------------------------------------------------------
// Tutor availability (D46): weekly windows in business-local time, on the
// hour, within business hours 08:00-20:00. The database enforces the same.
// ---------------------------------------------------------------------------
export const BUSINESS_OPEN_HOUR = 8;
export const BUSINESS_CLOSE_HOUR = 20;

const hourTime = z
  .string()
  .regex(/^\d{2}:00$/, "Use whole hours, e.g. 09:00.")
  .refine((t) => {
    const h = Number(t.slice(0, 2));
    return h >= BUSINESS_OPEN_HOUR && h <= BUSINESS_CLOSE_HOUR;
  }, `Hours must be between ${String(BUSINESS_OPEN_HOUR).padStart(2, "0")}:00 and ${BUSINESS_CLOSE_HOUR}:00.`);

export const availabilityWindow = z
  .strictObject({
    weekday: z.number().int().min(1).max(7), // ISO: 1 = Monday
    start: hourTime,
    end: hourTime,
  })
  .refine((w) => w.start < w.end, { message: "A window must end after it starts.", path: ["end"] });
export type AvailabilityWindow = z.infer<typeof availabilityWindow>;

export const setAvailabilitySchema = z
  .strictObject({ windows: z.array(availabilityWindow).max(7 * 12) })
  .refine(
    ({ windows }) =>
      windows.every((a, i) =>
        windows.every((b, j) => i === j || a.weekday !== b.weekday || a.end <= b.start || b.end <= a.start),
      ),
    { message: "Windows on the same day must not overlap.", path: ["windows"] },
  );
export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;
