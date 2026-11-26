/**
 * Date formatting. Every time is shown in the business timezone (D22),
 * whatever the viewer's device is set to, so server and client renders match
 * and everyone sees the same wall-clock time.
 */
export const BUSINESS_TIMEZONE = "Australia/Melbourne";

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-AU", { timeZone: BUSINESS_TIMEZONE, ...options });

const dateTimeFmt = fmt({
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const dayLabelFmt = fmt({ weekday: "short", day: "numeric", month: "short" });
const timeFmt = fmt({ hour: "numeric", minute: "2-digit" });
// en-CA formats dates as YYYY-MM-DD, which sorts correctly as a string.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "Thu, 27 Nov 2026, 4:00 pm AEDT" */
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));
/** "Thu 27 Nov" */
export const formatDayLabel = (iso: string) => dayLabelFmt.format(new Date(iso));
/** "4:00 pm" */
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
/** "2026-11-27" in business-local time, for grouping slots by day. */
export const dayKey = (iso: string) => dayKeyFmt.format(new Date(iso));
