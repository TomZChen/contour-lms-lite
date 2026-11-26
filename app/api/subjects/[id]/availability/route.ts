import { authedRoute, json, parseParams, parseQuery } from "@/lib/api/route";
import { getSubjectAvailability } from "@/lib/server/subjects";
import { availabilityQuery, idParams } from "@/lib/validation";

/**
 * GET /api/subjects/:id/availability?from&to&tutorId&at
 * Free slots per tutor (default: next 14 days, max 31), booked-out flags, and
 * recommended alternative tutors for the same subject.
 */
export const GET = authedRoute<{ id: string }>(async ({ req, params, supabase }) => {
  const { id } = parseParams(params, idParams);
  const query = parseQuery(req, availabilityQuery);
  return json(await getSubjectAvailability(supabase, id, query));
});
