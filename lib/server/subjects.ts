import "server-only";

import { ApiError, fromPostgrestError, notFound } from "@/lib/api/errors";
import type { AvailabilityDto, SubjectDto, TutorAvailabilityDto } from "@/lib/dto";
import type { AvailabilityQuery } from "@/lib/validation";
import type { Db } from "./auth";

/** All subjects with the tutors who teach them, alphabetically. */
export async function listSubjects(supabase: Db): Promise<SubjectDto[]> {
  const { data, error } = await supabase
    .from("subjects")
    .select("id, slug, name, tutor_subjects ( tutor:profiles ( id, full_name ) )")
    .order("name");
  if (error) throw fromPostgrestError(error);

  return data.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    tutors: s.tutor_subjects
      .flatMap((ts) => (ts.tutor ? [{ id: ts.tutor.id, fullName: ts.tutor.full_name }] : []))
      .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? "")),
  }));
}

/**
 * Free slots per tutor for a subject, whether each tutor is booked out, and
 * (when a tutor and/or time is requested) recommended alternative tutors for
 * the same subject (D25).
 */
export async function getSubjectAvailability(
  supabase: Db,
  subjectId: string,
  q: AvailabilityQuery,
): Promise<AvailabilityDto> {
  const [subjectRes, slotsRes] = await Promise.all([
    supabase
      .from("subjects")
      .select("id, name, tutor_subjects ( tutor:profiles ( id, full_name ) )")
      .eq("id", subjectId)
      .maybeSingle(),
    supabase.rpc("get_free_slots", {
      p_subject_id: subjectId,
      p_from: q.from.toISOString(),
      p_to: q.to.toISOString(),
    }),
  ]);
  if (subjectRes.error) throw fromPostgrestError(subjectRes.error);
  if (!subjectRes.data) throw notFound("Subject");
  if (slotsRes.error) throw fromPostgrestError(slotsRes.error);

  const slotsByTutor = new Map<string, string[]>();
  for (const { tutor_id, slot_start } of slotsRes.data) {
    const iso = new Date(slot_start).toISOString();
    slotsByTutor.set(tutor_id, [...(slotsByTutor.get(tutor_id) ?? []), iso]);
  }

  const at = q.at ? new Date(q.at).toISOString() : undefined;
  const tutors: TutorAvailabilityDto[] = subjectRes.data.tutor_subjects
    .flatMap((ts) => (ts.tutor ? [ts.tutor] : []))
    .map((t) => {
      const freeSlots = slotsByTutor.get(t.id) ?? [];
      return {
        id: t.id,
        fullName: t.full_name,
        freeSlots,
        nextFreeSlot: freeSlots[0] ?? null,
        bookedOut: freeSlots.length === 0,
        ...(at ? { freeAtRequestedTime: freeSlots.includes(at) } : {}),
      };
    })
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));

  let requestedTutor: AvailabilityDto["requestedTutor"];
  if (q.tutorId) {
    const t = tutors.find((x) => x.id === q.tutorId);
    if (!t) throw new ApiError(422, "tutor_not_in_subject", "The selected tutor does not teach that subject.");
    requestedTutor = { ...t, needsAlternative: t.bookedOut || t.freeAtRequestedTime === false };
  }

  // Recommend only when useful: the requested tutor can't take the booking,
  // or a time was given without a tutor. Prefer tutors free at the requested
  // time, then whoever is free soonest.
  const shouldRecommend = requestedTutor ? requestedTutor.needsAlternative : Boolean(at);
  const recommendations = shouldRecommend
    ? tutors
        .filter((t) => t.id !== q.tutorId && !t.bookedOut)
        .filter((t) => !at || t.freeAtRequestedTime || requestedTutor)
        .sort(
          (a, b) =>
            Number(b.freeAtRequestedTime ?? false) - Number(a.freeAtRequestedTime ?? false) ||
            (a.nextFreeSlot ?? "").localeCompare(b.nextFreeSlot ?? ""),
        )
    : [];

  return {
    subject: { id: subjectRes.data.id, name: subjectRes.data.name },
    range: { from: q.from.toISOString(), to: q.to.toISOString() },
    tutors,
    ...(requestedTutor ? { requestedTutor } : {}),
    recommendations,
  };
}
