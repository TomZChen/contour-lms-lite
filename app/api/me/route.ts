import { authedRoute, json } from "@/lib/api/route";

/** GET /api/me: the signed-in user and their role. */
export const GET = authedRoute(async ({ user }) => json(user));
