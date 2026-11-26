import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { getSessionUser, type CurrentUser } from "@/lib/server/auth";
import { ROLE_HOME, ROLE_LABEL, ROLE_NAV, type AppRole } from "@/lib/roles";

function Shell({ user, children }: { user?: CurrentUser; children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4 text-sm">
          <Link href={user ? ROLE_HOME[user.role] : "/"} className="font-semibold">
            Contour LMS Lite
          </Link>
          <nav className="flex gap-4">
            {user &&
              ROLE_NAV[user.role].map((item) => (
                <Link key={item.href} href={item.href} className="text-muted-foreground hover:text-foreground">
                  {item.label}
                </Link>
              ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <span className="hidden sm:inline text-muted-foreground">{user.fullName ?? user.email}</span>
                <Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>
                <ThemeSwitcher />
                <LogoutButton />
              </>
            ) : (
              <Skeleton className="h-8 w-48" />
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}

/**
 * Server-side role gate for a role's area of the app (D38). Runs on every
 * request inside Suspense (required for cookie access with Cache Components).
 * This is a UX boundary; the data layer re-checks the role (requireRole) and
 * RLS enforces it in the database.
 */
async function RoleGate({ role, children }: { role: AppRole; children: ReactNode }) {
  const { user } = await getSessionUser();
  if (!user) redirect("/auth/login");
  if (user.role !== role) redirect(ROLE_HOME[user.role]);
  return <Shell user={user}>{children}</Shell>;
}

export function RoleLayout({ role, children }: { role: AppRole; children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <Shell>
          <div className="space-y-4">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        </Shell>
      }
    >
      <RoleGate role={role}>{children}</RoleGate>
    </Suspense>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
