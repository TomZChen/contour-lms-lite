import { authedRoute, json, parseParams } from "@/lib/api/route";
import { getConsultation } from "@/lib/server/consultations";
import { idParams } from "@/lib/validation";

/** GET /api/consultations/:id: visible to its student, its tutor, and admins. */
export const GET = authedRoute<{ id: string }>(async ({ params, supabase }) => {
  const { id } = parseParams(params, idParams);
  return json(await getConsultation(supabase, id));
});
