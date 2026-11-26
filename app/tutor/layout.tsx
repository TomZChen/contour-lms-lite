import { RoleLayout } from "@/components/app-shell";

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout role="tutor">{children}</RoleLayout>;
}
