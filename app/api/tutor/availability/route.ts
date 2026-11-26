import { authedRoute, json, parseBody } from "@/lib/api/route";
import { getMySchedule, setMyAvailability } from "@/lib/server/availability";
import { setAvailabilitySchema } from "@/lib/validation";

/**
 * GET /api/tutor/availability
 * The signed-in tutor's weekly windows, plus the weekly hours that hold
 * upcoming sessions (tutors only, D46).
 */
export const GET = authedRoute(async ({ supabase, user }) => json(await getMySchedule(supabase, user)));

/**
 * PUT /api/tutor/availability  { windows: [{ weekday, start, end }] }
 * Replace the tutor's whole week atomically. 409 `availability_conflict` (with
 * the sessions in `details.conflicts`) if it would remove a booked hour.
 */
export const PUT = authedRoute(async ({ req, supabase, user }) => {
  const input = await parseBody(req, setAvailabilitySchema);
  return json(await setMyAvailability(supabase, user, input));
});
