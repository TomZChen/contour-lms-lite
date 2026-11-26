import "server-only";

import { isDateKey, localParts, startOfWeek } from "@/lib/calendar";
import type { ConsultationStatus } from "@/lib/dto";
import { adminListConsultationsQuery } from "@/lib/validation";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Turn page searchParams into list filters using the API's own schema, so the
 * server render and "Load more" (which calls the API) always agree. Invalid
 * values fall back to defaults instead of erroring the page.
 */
export function parseListParams(sp: SearchParams, defaults: { status: ConsultationStatus | "all"; order: "asc" | "desc" }) {
  const first = (k: string) => (Array.isArray(sp[k]) ? sp[k][0] : sp[k]);
  const statusParam = first("status") ?? defaults.status;
  const status = statusParam === "all" ? undefined : statusParam;

  const raw = {
    status,
    order: first("order") ?? defaults.order,
    subjectId: first("subjectId"),
    tutorId: first("tutorId"),
    q: first("q"),
    limit: "20",
  };
  const parsed = adminListConsultationsQuery.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined)),
  );
  const query = parsed.success ? parsed.data : adminListConsultationsQuery.parse({ ...defaults, status: defaults.status === "all" ? undefined : defaults.status });

  // Query-string form of the filters, for client-side "Load more" requests.
  const apiQuery: Record<string, string> = { limit: String(query.limit), order: query.order };
  if (query.status) apiQuery.status = query.status;
  if (query.subjectId) apiQuery.subjectId = query.subjectId;
  if (query.tutorId) apiQuery.tutorId = query.tutorId;
  if (query.q) apiQuery.q = query.q;

  // List or week calendar (D47). `week` is any day of the week to show;
  // it's normalised to that week's Monday. Defaults to the current week.
  const view = first("view") === "calendar" ? "calendar" : "list";
  const todayKey = localParts(new Date()).dateKey;
  const weekParam = first("week");
  const weekKey = startOfWeek(weekParam && isDateKey(weekParam) ? weekParam : todayKey);

  return { query, apiQuery, currentTab: query.status ?? "all", view, weekKey, todayKey } as const;
}
