import type { ReactNode } from "react";
import { ConsultationList } from "@/components/consultation-list";
import { StatusTabs, ViewToggle } from "@/components/list-filters";
import { WeekCalendar } from "@/components/week-calendar";
import { weekRange } from "@/lib/calendar";
import { getSessionUser } from "@/lib/server/auth";
import { listAllConsultations, listConsultationsForWeek, listMyConsultations } from "@/lib/server/consultations";
import { parseListParams } from "@/lib/server/list-params";

type Props = {
  mode: "student" | "tutor" | "admin";
  searchParams: Record<string, string | string[] | undefined>;
  defaults: Parameters<typeof parseListParams>[1];
  emptyMessage: (q: { q?: string }) => string;
  /** Extra filters above the status tabs (admin). */
  filters?: ReactNode;
};

/**
 * The consultations area shared by /student, /tutor and /admin: filters,
 * status tabs and either the paginated list (D41) or the week calendar (D47).
 * Both views read through the same service and filters.
 */
export async function ConsultationsView({ mode, searchParams, defaults, emptyMessage, filters }: Props) {
  const { query, apiQuery, currentTab, view, weekKey, todayKey } = parseListParams(searchParams, defaults);
  const { supabase, user } = await getSessionUser();

  return (
    <>
      {filters}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <StatusTabs current={currentTab} />
        <ViewToggle current={view} />
      </div>
      {view === "calendar" ? (
        <WeekCalendar
          key={weekKey}
          mode={mode}
          weekKey={weekKey}
          todayKey={todayKey}
          {...(await listConsultationsForWeek(supabase, user!, query, weekRange(weekKey)))}
        />
      ) : (
        <ConsultationList
          key={JSON.stringify(apiQuery)}
          mode={mode}
          initial={
            mode === "admin"
              ? await listAllConsultations(supabase, user!, query)
              : await listMyConsultations(supabase, user!, query)
          }
          endpoint={mode === "admin" ? "/api/admin/consultations" : "/api/consultations"}
          query={apiQuery}
          status={query.status}
          emptyMessage={emptyMessage(query)}
        />
      )}
    </>
  );
}
