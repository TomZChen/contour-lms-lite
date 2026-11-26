import { authedRoute, json, parseParams } from "@/lib/api/route";
import { setConsultationCompleted } from "@/lib/server/consultations";
import { idParams } from "@/lib/validation";

/*
 * The completion is modelled as a sub-resource, so both directions are
 * idempotent: PUT marks complete, DELETE marks incomplete (D28).
 */

/** PUT /api/consultations/:id/completion: mark complete (only once it has ended). */
export const PUT = authedRoute<{ id: string }>(async ({ params, supabase, user }) => {
  const { id } = parseParams(params, idParams);
  return json(await setConsultationCompleted(supabase, user, id, true));
});

/** DELETE /api/consultations/:id/completion: mark incomplete. */
export const DELETE = authedRoute<{ id: string }>(async ({ params, supabase, user }) => {
  const { id } = parseParams(params, idParams);
  return json(await setConsultationCompleted(supabase, user, id, false));
});
