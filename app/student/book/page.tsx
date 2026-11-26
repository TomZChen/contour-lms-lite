import { PageHeader } from "@/components/app-shell";
import { BookingForm } from "@/components/booking-form";
import { getSessionUser } from "@/lib/server/auth";
import { listSubjects } from "@/lib/server/subjects";

export default async function BookPage() {
  const { supabase, user } = await getSessionUser();
  const subjects = await listSubjects(supabase);
  // Prefill names from the profile when known; the student can edit them.
  const [first = "", ...rest] = (user?.fullName ?? "").split(" ");

  return (
    <>
      <PageHeader
        title="Book a consultation"
        description="Pick a subject and tutor. Booked-out tutors are flagged, with alternatives suggested."
      />
      <BookingForm subjects={subjects} defaultFirstName={first} defaultLastName={rest.join(" ")} />
    </>
  );
}
