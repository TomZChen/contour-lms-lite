import { authedRoute, json, parseBody, parseQuery } from "@/lib/api/route";
import { createConsultation, listMyConsultations } from "@/lib/server/consultations";
import { createConsultationSchema, listConsultationsQuery } from "@/lib/validation";

/**
 * GET /api/consultations?cursor&limit&status&order
 * The caller's consultations: a student's bookings or a tutor's sessions.
 * Admins use /api/admin/consultations.
 */
export const GET = authedRoute(async ({ req, supabase, user }) => {
  const query = parseQuery(req, listConsultationsQuery);
  return json(await listMyConsultations(supabase, user, query));
});

/** POST /api/consultations: book a consultation (students only). */
export const POST = authedRoute(async ({ req, supabase, user }) => {
  const input = await parseBody(req, createConsultationSchema);
  const consultation = await createConsultation(supabase, user, input);
  return json(consultation, {
    status: 201,
    headers: { Location: `/api/consultations/${consultation.id}` },
  });
});
