import { BUSINESS_TIMEZONE } from "@/lib/format";

/*
 * Calendar maths in the business timezone (D22), without a date library.
 * Days are identified by "YYYY-MM-DD" keys in Melbourne time; weeks by the
 * key of their Monday. Safe on server and client.
 */

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Melbourne-local date key, ISO weekday (1 = Monday) and hour of an instant. */
export function localParts(at: string | Date) {
  const p = Object.fromEntries(
    partsFmt.formatToParts(new Date(at)).map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAY[p.weekday],
    hour: Number(p.hour),
    minute: Number(p.minute),
  };
}

const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(s: string): boolean {
  const m = DATE_KEY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === s;
}

/** Calendar arithmetic on date keys (timezone-free). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ISO weekday (1 = Monday) of a date key. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
}

/** Monday of the week containing `key`. */
export const startOfWeek = (key: string) => addDays(key, 1 - weekdayOf(key));

/**
 * The instant that is `hour`:00 Melbourne time on the given day. Found by
 * correcting a UTC guess with the zone offset at that time (twice, so it is
 * right across daylight-saving changes).
 */
export function zonedTime(key: string, hour = 0): Date {
  const [y, m, d] = key.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d, hour);
  let t = target;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t));
    const [ly, lm, ld] = p.dateKey.split("-").map(Number);
    const local = Date.UTC(ly, lm - 1, ld, p.hour, p.minute);
    t += target - local;
  }
  return new Date(t);
}

/** The seven day keys and the [from, to) instants of the week starting `weekKey`. */
export function weekRange(weekKey: string) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekKey, i));
  return { days, from: zonedTime(weekKey), to: zonedTime(addDays(weekKey, 7)) };
}
