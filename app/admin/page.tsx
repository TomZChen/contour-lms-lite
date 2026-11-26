import { PageHeader } from "@/components/app-shell";
import { ConsultationList } from "@/components/consultation-list";
import { AdminFilters, StatusTabs } from "@/components/list-filters";
import { getSessionUser } from "@/lib/server/auth";
import { listAllConsultations } from "@/lib/server/consultations";
import { parseListParams } from "@/lib/server/list-params";
import { listSubjects } from "@/lib/server/subjects";

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { query, apiQuery, currentTab } = parseListParams(sp, { status: "all", order: "desc" });
  const { supabase, user } = await getSessionUser();
  const [page, subjects] = await Promise.all([
    listAllConsultations(supabase, user!, query),
    listSubjects(supabase),
  ]);

  return (
    <>
      <PageHeader title="All consultations" description="Every consultation across the system (read-only)." />
      <AdminFilters subjects={subjects} />
      <StatusTabs current={currentTab} />
      <ConsultationList
        key={JSON.stringify(apiQuery)}
        mode="admin"
        initial={page}
        endpoint="/api/admin/consultations"
        query={apiQuery}
        status={query.status}
        emptyMessage={query.q ? `No consultations for a student matching “${query.q}”.` : "No consultations match these filters."}
      />
    </>
  );
}
