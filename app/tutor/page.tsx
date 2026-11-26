import { PageHeader } from "@/components/app-shell";
import { ConsultationList } from "@/components/consultation-list";
import { StatusTabs } from "@/components/list-filters";
import { getSessionUser } from "@/lib/server/auth";
import { listMyConsultations } from "@/lib/server/consultations";
import { parseListParams } from "@/lib/server/list-params";

export default async function TutorHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { query, apiQuery, currentTab } = parseListParams(sp, { status: "scheduled", order: "asc" });
  const { supabase, user } = await getSessionUser();
  const page = await listMyConsultations(supabase, user!, query);

  return (
    <>
      <PageHeader title="My sessions" description="Consultations students have booked with you (read-only)." />
      <StatusTabs current={currentTab} />
      <ConsultationList
        key={JSON.stringify(apiQuery)}
        mode="tutor"
        initial={page}
        endpoint="/api/consultations"
        query={apiQuery}
        status={query.status}
        emptyMessage="No sessions here yet."
      />
    </>
  );
}
