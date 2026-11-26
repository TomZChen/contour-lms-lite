import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { ConsultationList } from "@/components/consultation-list";
import { StatusTabs } from "@/components/list-filters";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/server/auth";
import { listMyConsultations } from "@/lib/server/consultations";
import { parseListParams } from "@/lib/server/list-params";

export default async function StudentHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const { query, apiQuery, currentTab } = parseListParams(sp, { status: "scheduled", order: "asc" });
  const { supabase, user } = await getSessionUser();
  const page = await listMyConsultations(supabase, user!, query);

  return (
    <>
      <PageHeader
        title="My consultations"
        description="Mark consultations complete once they have ended, reschedule, or cancel."
        action={<Button asChild><Link href="/student/book">Book a consultation</Link></Button>}
      />
      <StatusTabs current={currentTab} />
      <ConsultationList
        key={JSON.stringify(apiQuery)}
        mode="student"
        initial={page}
        endpoint="/api/consultations"
        query={apiQuery}
        status={query.status}
        emptyMessage="No consultations here yet."
      />
    </>
  );
}
