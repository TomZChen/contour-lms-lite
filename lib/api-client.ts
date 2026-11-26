import type { ApiErrorBody } from "@/lib/dto";

/**
 * Browser-side wrapper around the app's own API routes. Same-origin fetch
 * sends the session cookie automatically; bodies are always JSON, which the
 * API requires for CSRF protection (D32).
 */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** Friendlier, action-oriented copy for the error codes users can hit. */
const FRIENDLY: Record<string, string> = {
  unauthorized: "Your session has expired. Please sign in again.",
  slot_taken: "Sorry, that slot was just taken. Please pick another time.",
  tutor_unavailable: "That tutor isn't available at that time. Please pick another slot.",
  slot_in_past: "That time has already passed. Please pick a future slot.",
  slot_not_on_the_hour: "Consultations start on the hour.",
  consultation_not_ended: "You can mark a consultation complete once it has ended.",
  consultation_completed: "This consultation is completed. Mark it incomplete first.",
  consultation_cancelled: "This consultation has been cancelled.",
};

export async function apiFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
    cache: "no-store",
  });

  if (res.ok) return (await res.json()) as T;

  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error */
  }
  const code = body?.error.code ?? "internal_error";
  throw new ApiClientError(
    res.status,
    code,
    FRIENDLY[code] ?? body?.error.message ?? "Something went wrong. Please try again.",
    body?.error.details,
  );
}

/** Error codes meaning the chosen slot is no longer bookable. */
export const SLOT_ERROR_CODES = new Set([
  "slot_taken",
  "tutor_unavailable",
  "slot_in_past",
  "slot_not_on_the_hour",
]);
