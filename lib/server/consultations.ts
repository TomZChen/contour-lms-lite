import "server-only";

import { z } from "zod";
import { ApiError, fromPostgrestError, notFound } from "@/lib/api/errors";
import type { ConsultationDto, ConsultationStatus, Page } from "@/lib/dto";
import type {
  AdminListConsultationsQuery,
  CreateConsultationInput,
  ListConsultationsQuery,
  RescheduleInput,
} from "@/lib/validation";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { requireRole, type CurrentUser, type Db } from "./auth";

/*
 * All consultation reads and writes. Used by the API route handlers and
 * directly by Server Components (D29), always with the caller's own
 * RLS-scoped Supabase client.
 */

const CONSULTATION_COLUMNS = `
  id, student_id, first_name, last_name, reason,
  scheduled_at, ends_at, completed_at, cancelled_at, created_at, updated_at,
  subject:subjects!consultations_subject_id_fkey ( id, slug, name ),
  tutor:profiles!consultations_tutor_id_fkey ( id, full_name )
`;

type ConsultationRow = {
  id: string;
  student_id: string;
  first_name: string;
  last_name: string;
  reason: string;
  scheduled_at: string;
  ends_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  subject: { id: string; slug: string; name: string } | null;
  tutor: { id: string; full_name: string | null } | null;
};

export function statusOf(row: { completed_at: string | null; cancelled_at: string | null }): ConsultationStatus {
  if (row.cancelled_at) return "cancelled";
  if (row.completed_at) return "completed";
  return "scheduled";
}

function toDto(row: ConsultationRow): ConsultationDto {
  return {
    id: row.id,
    studentId: row.student_id,
    firstName: row.first_name,
    lastName: row.last_name,
    reason: row.reason,
    scheduledAt: row.scheduled_at,
    endsAt: row.ends_at,
    status: statusOf(row),
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    // Both are NOT NULL FKs; the embeds can only be null if RLS hid them.
    subject: row.subject ?? { id: "", slug: "", name: "Unknown subject" },
    tutor: row.tutor ? { id: row.tutor.id, fullName: row.tutor.full_name } : { id: "", fullName: null },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Keyset pagination (D30). The cursor is the (scheduled_at, id) of the last
// row of the previous page, base64url-encoded. It is validated on decode, so
// the values interpolated into the PostgREST filter are always a timestamp
// and a uuid, never arbitrary input.
// ---------------------------------------------------------------------------
const cursorSchema = z.tuple([z.iso.datetime({ offset: true }), z.guid()]);

function encodeCursor(row: Pick<ConsultationRow, "scheduled_at" | "id">): string {
  return Buffer.from(JSON.stringify([row.scheduled_at, row.id])).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw new ApiError(400, "validation_failed", "Invalid cursor.");
  }
}

type ListFilters = Partial<Pick<AdminListConsultationsQuery, "q" | "studentId" | "tutorId" | "subjectId">> &
  ListConsultationsQuery;

async function listConsultations(supabase: Db, q: ListFilters): Promise<Page<ConsultationDto>> {
  const ascending = q.order === "asc";
  let query = supabase.from("consultations").select(CONSULTATION_COLUMNS);

  if (q.studentId) query = query.eq("student_id", q.studentId);
  if (q.tutorId) query = query.eq("tutor_id", q.tutorId);
  if (q.subjectId) query = query.eq("subject_id", q.subjectId);

  // Name search: every word must appear in the first or last name, ignoring
  // case. `nameSearch` only allows letters, spaces, ' . and -, so a quoted
  // word can't break out of the filter or add LIKE wildcards. Backed by
  // trigram indexes (see the name-search migration).
  for (const word of q.q?.split(" ").slice(0, 5) ?? []) {
    query = query.or(`first_name.ilike."*${word}*",last_name.ilike."*${word}*"`);
  }

  if (q.from) query = query.gte("scheduled_at", q.from);
  if (q.to) query = query.lt("scheduled_at", q.to);

  if (q.status === "scheduled") query = query.is("completed_at", null).is("cancelled_at", null);
  if (q.status === "completed") query = query.not("completed_at", "is", null);
  if (q.status === "cancelled") query = query.not("cancelled_at", "is", null);

  if (q.cursor) {
    const [at, id] = decodeCursor(q.cursor);
    const op = ascending ? "gt" : "lt";
    query = query.or(`scheduled_at.${op}."${at}",and(scheduled_at.eq."${at}",id.${op}.${id})`);
  }

  const { data, error } = await query
    .order("scheduled_at", { ascending })
    .order("id", { ascending })
    .limit(q.limit + 1) // one extra row tells us whether another page exists
    .overrideTypes<ConsultationRow[], { merge: false }>();
  if (error) throw fromPostgrestError(error);

  const hasMore = data.length > q.limit;
  const rows = hasMore ? data.slice(0, q.limit) : data;
  return {
    items: rows.map(toDto),
    nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
  };
}

/** "My consultations": a student's bookings, or a tutor's sessions. */
export function listMyConsultations(supabase: Db, user: CurrentUser, q: ListConsultationsQuery) {
  requireRole(user, "student", "tutor");
  return listConsultations(supabase, {
    ...q,
    ...(user.role === "student" ? { studentId: user.id } : { tutorId: user.id }),
  });
}

/** Every consultation in the system, with optional filters (admin only). */
export function listAllConsultations(supabase: Db, user: CurrentUser, q: AdminListConsultationsQuery) {
  requireRole(user, "admin");
  return listConsultations(supabase, q);
}

/** Most sessions one calendar week shows; past that the view asks for filters. */
export const CALENDAR_LIMIT = 500;

/**
 * One calendar week of the caller's consultations (student, tutor) or of all
 * consultations (admin), with the same filters as the list (D47).
 * `truncated` means more than CALENDAR_LIMIT matched.
 */
export async function listConsultationsForWeek(
  supabase: Db,
  user: CurrentUser,
  q: AdminListConsultationsQuery,
  range: { from: Date; to: Date },
): Promise<{ items: ConsultationDto[]; truncated: boolean }> {
  const query = {
    ...q,
    from: range.from.toISOString(),
    to: range.to.toISOString(),
    cursor: undefined,
    order: "asc" as const,
    limit: CALENDAR_LIMIT,
  };
  const page = user.role === "admin"
    ? await listAllConsultations(supabase, user, query)
    : await listMyConsultations(supabase, user, query);
  return { items: page.items, truncated: page.nextCursor !== null };
}

/** A single consultation the caller may see (owner, its tutor, or admin). */
export async function getConsultation(supabase: Db, id: string): Promise<ConsultationDto> {
  const { data, error } = await supabase
    .from("consultations")
    .select(CONSULTATION_COLUMNS)
    .eq("id", id)
    .overrideTypes<ConsultationRow[], { merge: false }>();
  if (error) throw fromPostgrestError(error);
  if (!data[0]) throw notFound("Consultation");
  return toDto(data[0]);
}

export async function createConsultation(
  supabase: Db,
  user: CurrentUser,
  input: CreateConsultationInput,
): Promise<ConsultationDto> {
  requireRole(user, "student");
  // student_id is not sent: it defaults to auth.uid() and RLS checks it (D12).
  // ends_at is NOT NULL but always derived by a trigger (D22) and not
  // client-writable, so it is deliberately omitted; the generated Insert type
  // cannot express "filled by a trigger", hence the cast.
  const row = {
    first_name: input.firstName,
    last_name: input.lastName,
    reason: input.reason,
    scheduled_at: input.scheduledAt,
    subject_id: input.subjectId,
    tutor_id: input.tutorId,
  } satisfies Omit<TablesInsert<"consultations">, "ends_at">;
  const { data, error } = await supabase
    .from("consultations")
    .insert(row as TablesInsert<"consultations">)
    .select(CONSULTATION_COLUMNS)
    .single()
    .overrideTypes<ConsultationRow, { merge: false }>();
  if (error) throw fromPostgrestError(error);
  return toDto(data);
}

/**
 * Load a consultation the caller is about to modify and check the state
 * rules up front, so the API can answer with a precise error. The database
 * enforces the same rules regardless (RLS + constraints).
 */
async function loadOwnOpenConsultation(supabase: Db, user: CurrentUser, id: string) {
  requireRole(user, "student");
  const consultation = await getConsultation(supabase, id);
  if (consultation.studentId !== user.id) {
    // Visible (e.g. a tutor or admin) but not theirs to change.
    throw new ApiError(403, "forbidden", "You can only manage your own consultations.");
  }
  if (consultation.status === "cancelled") {
    throw new ApiError(409, "consultation_cancelled", "This consultation has been cancelled.");
  }
  return consultation;
}

async function updateConsultation(
  supabase: Db,
  id: string,
  patch: { scheduled_at?: string; tutor_id?: string; completed_at?: string | null; cancelled_at?: string },
) {
  const { data, error } = await supabase
    .from("consultations")
    .update(patch)
    .eq("id", id)
    .select(CONSULTATION_COLUMNS)
    .single()
    .overrideTypes<ConsultationRow, { merge: false }>();
  if (error) throw fromPostgrestError(error);
  return toDto(data);
}

export async function rescheduleConsultation(
  supabase: Db,
  user: CurrentUser,
  id: string,
  input: RescheduleInput,
) {
  const consultation = await loadOwnOpenConsultation(supabase, user, id);
  if (consultation.status === "completed") {
    throw new ApiError(409, "consultation_completed", "A completed consultation cannot be rescheduled.");
  }
  return updateConsultation(supabase, id, {
    scheduled_at: input.scheduledAt,
    ...(input.tutorId ? { tutor_id: input.tutorId } : {}),
  });
}

export async function setConsultationCompleted(
  supabase: Db,
  user: CurrentUser,
  id: string,
  completed: boolean,
) {
  const consultation = await loadOwnOpenConsultation(supabase, user, id);
  if (completed && new Date(consultation.endsAt).getTime() > Date.now()) {
    throw new ApiError(
      422,
      "consultation_not_ended",
      "A consultation can only be marked complete after it has ended.",
    );
  }
  // Idempotent: completing an already-completed consultation keeps its timestamp.
  if (completed === (consultation.status === "completed")) return consultation;
  return updateConsultation(supabase, id, {
    completed_at: completed ? new Date().toISOString() : null,
  });
}

export async function cancelConsultation(supabase: Db, user: CurrentUser, id: string) {
  const consultation = await loadOwnOpenConsultation(supabase, user, id);
  if (consultation.status === "completed") {
    // D15: mark it incomplete first.
    throw new ApiError(
      409,
      "consultation_completed",
      "A completed consultation cannot be cancelled. Mark it incomplete first.",
    );
  }
  return updateConsultation(supabase, id, { cancelled_at: new Date().toISOString() });
}
