import Link from "next/link";
import { PageHeader } from "@/components/app-shell";
import { ConsultationsView } from "@/components/consultations-view";
import { Button } from "@/components/ui/button";

export default async function TutorHomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      <PageHeader
        title="My sessions"
        description="Consultations students have booked with you (read-only)."
        action={<Button asChild variant="outline"><Link href="/tutor/availability">Set availability</Link></Button>}
      />
      <ConsultationsView
        mode="tutor"
        searchParams={await searchParams}
        defaults={{ status: "scheduled", order: "asc" }}
        emptyMessage={() => "No sessions here yet."}
      />
    </>
  );
}
