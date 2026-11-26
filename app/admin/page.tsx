import { PageHeader } from "@/components/app-shell";
import { ConsultationsView } from "@/components/consultations-view";
import { AdminFilters } from "@/components/list-filters";
import { getSessionUser } from "@/lib/server/auth";
import { listSubjects } from "@/lib/server/subjects";

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await getSessionUser();
  const subjects = await listSubjects(supabase);

  return (
    <>
      <PageHeader title="All consultations" description="Every consultation across the system (read-only)." />
      <ConsultationsView
        mode="admin"
        searchParams={sp}
        defaults={{ status: "all", order: "desc" }}
        filters={<AdminFilters subjects={subjects} />}
        emptyMessage={({ q }) => (q ? `No consultations for a student matching “${q}”.` : "No consultations match these filters.")}
      />
    </>
  );
}
