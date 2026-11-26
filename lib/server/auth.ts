import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { ApiError } from "@/lib/api/errors";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type Db = SupabaseClient<Database>;

export type CurrentUser = {
  id: string;
  email: string | null;
  role: AppRole;
  fullName: string | null;
};

/**
 * Resolve the signed-in user and their role.
 *
 * `getClaims()` verifies the session JWT. The role is then read from
 * `profiles` (D6), the source of truth, so a role change takes effect on the
 * next request rather than when the token refreshes.
 */
export async function getCurrentUser(supabase: Db): Promise<CurrentUser | null> {
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (!profile) return null;

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    role: profile.role,
    fullName: profile.full_name,
  };
}

/**
 * Per-render cached variant for Server Components: a layout and page that
 * both need the user share one lookup.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  return { supabase, user: await getCurrentUser(supabase) };
});

/**
 * Explicit role check at the application layer. RLS enforces the same rules
 * in the database (defence in depth, D7); this gives a clear 403 instead of an
 * empty result, and documents intent in the route code.
 */
export function requireRole(user: CurrentUser, ...roles: AppRole[]): void {
  if (!roles.includes(user.role)) {
    throw new ApiError(403, "forbidden", "You are not allowed to perform this action.");
  }
}
