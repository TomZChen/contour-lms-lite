import { authedRoute, json, parseBody, parseParams } from "@/lib/api/route";
import { rescheduleConsultation } from "@/lib/server/consultations";
import { idParams, rescheduleSchema } from "@/lib/validation";

/**
 * POST /api/consultations/:id/reschedule  { scheduledAt, tutorId? }
 * Move to a new slot, optionally with another tutor of the same subject.
 */
export const POST = authedRoute<{ id: string }>(async ({ req, params, supabase, user }) => {
  const { id } = parseParams(params, idParams);
  const input = await parseBody(req, rescheduleSchema);
  return json(await rescheduleConsultation(supabase, user, id, input));
});
