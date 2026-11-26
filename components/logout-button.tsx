"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
    // Drop any cached Server Component output for the signed-in user.
    router.refresh();
  };

  return (
    <Button size="sm" variant="outline" onClick={logout}>
      Log out
    </Button>
  );
}
