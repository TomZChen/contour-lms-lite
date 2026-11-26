import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/server/auth";
import { ROLE_HOME } from "@/lib/roles";

async function RedirectToRoleHome(): Promise<never> {
  const { user } = await getSessionUser();
  redirect(user ? ROLE_HOME[user.role] : "/auth/login");
}

/** Single post-login entry point: sends each user to their role's area. */
export default function DashboardPage() {
  return (
    <Suspense>
      <RedirectToRoleHome />
    </Suspense>
  );
}
