import { PageHeader } from "@/components/app-shell";
import { AvailabilityEditor } from "@/components/availability-editor";
import { getSessionUser } from "@/lib/server/auth";
import { getMySchedule } from "@/lib/server/availability";

export default async function TutorAvailabilityPage() {
  const { supabase, user } = await getSessionUser();
  const schedule = await getMySchedule(supabase, user!);

  return (
    <>
      <PageHeader
        title="Availability"
        description="The hours you take consultations each week, in Melbourne time. Students can book any free hour you switch on."
      />
      <AvailabilityEditor initial={schedule} />
    </>
  );
}
