import "server-only";

import { fromPostgrestError } from "@/lib/api/errors";
import { localParts } from "@/lib/calendar";
import type { AvailabilityWindowDto, TutorScheduleDto } from "@/lib/dto";
import type { SetAvailabilityInput } from "@/lib/validation";
import { requireRole, type CurrentUser, type Db } from "./auth";

/*
 * A tutor's own weekly availability (D46). Reads go through RLS like any other
 * table read; the only write path is the set_my_availability() RPC, which
 * replaces the week atomically and refuses to strand booked sessions.
 */

/** "09:00:00" → "09:00" */
const hhmm = (t: string) => t.slice(0, 5);

export async function getMySchedule(supabase: Db, user: CurrentUser): Promise<TutorScheduleDto> {
  requireRole(user, "tutor");

  const [windowsRes, bookedRes] = await Promise.all([
    supabase
      .from("tutor_availability")
      .select("iso_weekday, start_time, end_time")
      .eq("tutor_id", user.id)
      .order("iso_weekday")
      .order("start_time"),
    // Upcoming scheduled sessions: their weekly hour can't be removed.
    supabase
      .from("consultations")
      .select("scheduled_at")
      .eq("tutor_id", user.id)
      .is("cancelled_at", null)
      .is("completed_at", null)
      .gt("scheduled_at", new Date().toISOString()),
  ]);
  if (windowsRes.error) throw fromPostgrestError(windowsRes.error);
  if (bookedRes.error) throw fromPostgrestError(bookedRes.error);

  const windows: AvailabilityWindowDto[] = windowsRes.data.map((w) => ({
    weekday: w.iso_weekday,
    start: hhmm(w.start_time),
    end: hhmm(w.end_time),
  }));

  const counts = new Map<string, { weekday: number; hour: number; count: number }>();
  for (const { scheduled_at } of bookedRes.data) {
    const { weekday, hour } = localParts(scheduled_at);
    const key = `${weekday}-${hour}`;
    const entry = counts.get(key) ?? { weekday, hour, count: 0 };
    entry.count++;
    counts.set(key, entry);
  }

  return { windows, booked: [...counts.values()] };
}

export async function setMyAvailability(
  supabase: Db,
  user: CurrentUser,
  input: SetAvailabilityInput,
): Promise<TutorScheduleDto> {
  requireRole(user, "tutor");
  const { error } = await supabase.rpc("set_my_availability", { p_windows: input.windows });
  if (error) throw fromPostgrestError(error);
  return getMySchedule(supabase, user);
}
