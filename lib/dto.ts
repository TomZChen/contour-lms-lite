/**
 * Response shapes of the API (camelCase, decoupled from the table layout).
 * Type-only, so safe to import from client components.
 */

export type ConsultationStatus = "scheduled" | "completed" | "cancelled";

export type ConsultationDto = {
  id: string;
  studentId: string;
  firstName: string;
  lastName: string;
  reason: string;
  scheduledAt: string;
  endsAt: string;
  status: ConsultationStatus;
  completedAt: string | null;
  cancelledAt: string | null;
  subject: { id: string; slug: string; name: string };
  tutor: { id: string; fullName: string | null };
  createdAt: string;
  updatedAt: string;
};

export type Page<T> = {
  items: T[];
  /** Opaque cursor for the next page, or null on the last page. */
  nextCursor: string | null;
};

export type SubjectDto = {
  id: string;
  slug: string;
  name: string;
  tutors: { id: string; fullName: string | null }[];
};

export type TutorAvailabilityDto = {
  id: string;
  fullName: string | null;
  freeSlots: string[];
  nextFreeSlot: string | null;
  /** No free slots anywhere in the requested range. */
  bookedOut: boolean;
  /** Present when `at` was requested. */
  freeAtRequestedTime?: boolean;
};

export type AvailabilityDto = {
  subject: { id: string; name: string };
  range: { from: string; to: string };
  tutors: TutorAvailabilityDto[];
  /** Present when `tutorId` was requested. */
  requestedTutor?: TutorAvailabilityDto & {
    /** True if the student should be offered alternatives. */
    needsAlternative: boolean;
  };
  /** Other tutors for the same subject who can take the booking. */
  recommendations: TutorAvailabilityDto[];
};

export type ApiErrorBody = {
  error: { code: string; message: string; details?: unknown };
};
