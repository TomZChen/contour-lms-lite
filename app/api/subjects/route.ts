import { authedRoute, json } from "@/lib/api/route";
import { listSubjects } from "@/lib/server/subjects";

/** GET /api/subjects: subjects with the tutors who teach them. */
export const GET = authedRoute(async ({ supabase }) => json({ items: await listSubjects(supabase) }));
