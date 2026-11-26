import type { Database } from "@/lib/supabase/database.types";

export type AppRole = Database["public"]["Enums"]["app_role"];

/** Each role has its own area of the app (D38). */
export const ROLE_HOME: Record<AppRole, string> = {
  student: "/student",
  tutor: "/tutor",
  admin: "/admin",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  student: "Student",
  tutor: "Tutor",
  admin: "Admin",
};

export const ROLE_NAV: Record<AppRole, { href: string; label: string }[]> = {
  student: [
    { href: "/student", label: "My consultations" },
    { href: "/student/book", label: "Book a consultation" },
  ],
  tutor: [{ href: "/tutor", label: "My sessions" }],
  admin: [{ href: "/admin", label: "All consultations" }],
};
