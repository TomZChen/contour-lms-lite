import { authedRoute, json, parseParams } from "@/lib/api/route";
import { cancelConsultation } from "@/lib/server/consultations";
import { idParams } from "@/lib/validation";

/** POST /api/consultations/:id/cancel: soft-cancel; the row is kept (D8). */
export const POST = authedRoute<{ id: string }>(async ({ params, supabase, user }) => {
  const { id } = parseParams(params, idParams);
  return json(await cancelConsultation(supabase, user, id));
});
