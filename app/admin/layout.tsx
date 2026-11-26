import { RoleLayout } from "@/components/app-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <RoleLayout role="admin">{children}</RoleLayout>;
}
