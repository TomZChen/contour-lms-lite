import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { ConsultationsView } from "@/components/consultations-view";
import { Button } from "@/components/ui/button";

export default async function StudentHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      <PageHeader
        title="My consultations"
        description="Mark consultations complete once they have ended, reschedule, or cancel."
        action={<Button asChild><Link href="/student/book">Book a consultation</Link></Button>}
      />
      <ConsultationsView
        mode="student"
        searchParams={await searchParams}
        defaults={{ status: "scheduled", order: "asc" }}
        emptyMessage={() => "No consultations here yet."}
      />
    </>
  );
}
