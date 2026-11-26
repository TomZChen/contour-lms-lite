import "server-only";

import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, type CurrentUser, type Db } from "@/lib/server/auth";
import { ApiError } from "./errors";

type RouteContext<P> = { params: Promise<P> };

export type AuthedContext<P> = {
  req: NextRequest;
  params: P;
  supabase: Db;
  user: CurrentUser;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Wrap a route handler with the cross-cutting concerns every API route needs:
 *   1. CSRF protection for state-changing methods
 *   2. Authentication (401 if there is no valid session)
 *   3. A request-scoped Supabase client acting as the user, so RLS applies
 *   4. Uniform error responses
 */
export function authedRoute<P = Record<string, never>>(
  handler: (ctx: AuthedContext<P>) => Promise<Response>,
) {
  return async (req: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      if (!SAFE_METHODS.has(req.method)) assertSameOrigin(req);

      const supabase = await createClient();
      const user = await getCurrentUser(supabase);
      if (!user) throw new ApiError(401, "unauthorized", "Please sign in.");

      return await handler({ req, params: await context.params, supabase, user });
    } catch (error) {
      // Let Next.js's own control-flow errors through (e.g. the rejection
      // cookies() uses during prerendering to mark the route dynamic).
      unstable_rethrow(error);
      return errorResponse(error);
    }
  };
}

/**
 * Session cookies are SameSite=Lax, which already blocks most cross-site
 * writes. As a second layer, reject state-changing requests that a browser
 * marks as cross-site, or whose Origin does not match this host.
 */
function assertSameOrigin(req: NextRequest) {
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new ApiError(403, "csrf_rejected", "Cross-site request rejected.");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      /* malformed Origin header */
    }
    if (!host || originHost !== host) {
      throw new ApiError(403, "csrf_rejected", "Cross-origin request rejected.");
    }
  }
}

/** Parse and validate a JSON body. Requires `Content-Type: application/json`. */
export async function parseBody<S extends z.ZodType>(req: NextRequest, schema: S): Promise<z.output<S>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "unsupported_media_type", "Expected application/json.");
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body is not valid JSON.");
  }
  return validate(schema, body);
}

/** Parse and validate the query string. */
export function parseQuery<S extends z.ZodType>(req: NextRequest, schema: S): z.output<S> {
  return validate(schema, Object.fromEntries(req.nextUrl.searchParams));
}

/** Validate route params (e.g. that an id is a UUID). */
export function parseParams<S extends z.ZodType>(params: unknown, schema: S): z.output<S> {
  const result = schema.safeParse(params);
  // A malformed id can never match a row: answer like any unknown id.
  if (!result.success) throw new ApiError(404, "not_found", "Not found.");
  return result.data;
}

function validate<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ApiError(400, "validation_failed", "The request is invalid.", z.flattenError(result.error));
  }
  return result.data;
}

/** JSON response for private, per-user data: never cached by shared caches. */
export function json(data: unknown, init: ResponseInit = {}) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
      { status: error.status },
    );
  }
  console.error("Unhandled API error", error);
  return json({ error: { code: "internal_error", message: "Something went wrong." } }, { status: 500 });
}
