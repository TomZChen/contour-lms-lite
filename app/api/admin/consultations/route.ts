import { authedRoute, json, parseQuery } from "@/lib/api/route";
import { listAllConsultations } from "@/lib/server/consultations";
import { adminListConsultationsQuery } from "@/lib/validation";

/**
 * GET /api/admin/consultations?cursor&limit&status&order&q&studentId&tutorId&subjectId
 * Every consultation in the system (admins only; read-only, D14).
 */
export const GET = authedRoute(async ({ req, supabase, user }) => {
  const query = parseQuery(req, adminListConsultationsQuery);
  return json(await listAllConsultations(supabase, user, query));
});
