import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { EnvVarWarning } from "@/components/env-var-warning";
import { getSessionUser } from "@/lib/server/auth";
import { ROLE_HOME } from "@/lib/roles";
import { hasEnvVars } from "@/lib/utils";

async function Actions() {
  const { user } = await getSessionUser();
  if (user) {
    return (
      <Button asChild size="lg">
        <Link href={ROLE_HOME[user.role]}>Go to your dashboard</Link>
      </Button>
    );
  }
  return (
    <div className="flex gap-3">
      <Button asChild size="lg"><Link href="/auth/login">Sign in</Link></Button>
      <Button asChild size="lg" variant="outline"><Link href="/auth/sign-up">Create an account</Link></Button>
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 text-sm">
        <span className="font-semibold">Contour LMS Lite</span>
        <ThemeSwitcher />
      </header>
      <section className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
        <h1 className="text-4xl font-bold tracking-tight">Book a consultation with a tutor</h1>
        <p className="text-muted-foreground text-lg">
          Biology, UCAT, Math Methods, Specialist Math, Physics and Chemistry. See who is available, book a
          60-minute slot, and manage your consultations in one place.
        </p>
        {hasEnvVars ? (
          <Suspense fallback={<div className="h-11" />}>
            <Actions />
          </Suspense>
        ) : (
          <EnvVarWarning />
        )}
      </section>
    </main>
  );
}
