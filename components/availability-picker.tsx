"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { AvailabilityDto, TutorAvailabilityDto } from "@/lib/dto";
import { dayKey, formatDateTime, formatDayLabel, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

type Props = {
  subjectId: string;
  tutorId: string | undefined;
  scheduledAt: string | undefined;
  onTutorChange: (tutorId: string) => void;
  onSlotChange: (scheduledAt: string | undefined) => void;
  /** Bump to force a refetch (e.g. after a "slot just taken" error). */
  refreshKey?: number;
};

type Result = { key: string; data?: AvailabilityDto; error?: string };

/**
 * Tutor + slot picker for a subject. Shows every tutor with a "Booked out"
 * badge when they have no free slots in the window, recommends alternative
 * tutors for the same subject when the chosen one can't take the booking
 * (D25), and lists the chosen tutor's free slots grouped by day.
 */
export function AvailabilityPicker({ subjectId, tutorId, scheduledAt, onTutorChange, onSlotChange, refreshKey = 0 }: Props) {
  const [windowOffset, setWindowOffset] = useState(0); // in WINDOW_DAYS steps
  const [result, setResult] = useState<Result>();

  // Everything that should trigger a refetch. The date window itself is
  // computed inside the effect, because it depends on the current time.
  const key = `${subjectId}|${tutorId ?? ""}|${windowOffset}|${refreshKey}`;
  const loading = result?.key !== key;

  useEffect(() => {
    const controller = new AbortController();
    const from = new Date(Date.now() + windowOffset * WINDOW_DAYS * DAY_MS);
    const to = new Date(from.getTime() + WINDOW_DAYS * DAY_MS);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (tutorId) params.set("tutorId", tutorId);

    apiFetch<AvailabilityDto>(`/api/subjects/${subjectId}/availability?${params}`, { signal: controller.signal })
      .then((data) => setResult({ key, data }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key, error: e instanceof ApiClientError ? e.message : "Could not load availability." });
      });
    return () => controller.abort();
  }, [key, subjectId, tutorId, windowOffset]);

  // Keep the last good data on screen while the next window loads.
  const data = result?.data;
  const selected = data?.tutors.find((t) => t.id === tutorId);
  const requested = data?.requestedTutor;

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const slot of selected?.freeSlots ?? []) {
      const k = dayKey(slot);
      groups.set(k, [...(groups.get(k) ?? []), slot]);
    }
    return [...groups.entries()];
  }, [selected]);

  const selectTutor = (t: TutorAvailabilityDto) => {
    if (t.id === tutorId) return;
    onTutorChange(t.id);
    onSlotChange(undefined);
  };

  if (result?.error && !data) {
    return <p className="text-destructive text-sm">{result.error}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tutors */}
      <div>
        <p className="mb-2 text-sm font-medium">Tutor</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {data.tutors.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTutor(t)}
              aria-pressed={t.id === tutorId}
              className={cn(
                "rounded-md border p-3 text-left text-sm transition-colors hover:bg-accent",
                t.id === tutorId && "border-primary ring-1 ring-primary",
              )}
            >
              <span className="font-medium">{t.fullName ?? "Tutor"}</span>
              <span className="mt-1 block">
                {t.bookedOut ? (
                  <Badge variant="destructive">Booked out</Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Next free: {formatDayLabel(t.nextFreeSlot!)} {formatTime(t.nextFreeSlot!)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Recommendations when the chosen tutor can't take the booking */}
      {requested?.needsAlternative && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" />
            {requested.fullName} is booked out for these dates.
          </p>
          {data.recommendations.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Recommended for {data.subject.name}:</span>
              {data.recommendations.map((r) => (
                <Button key={r.id} type="button" size="sm" variant="secondary" onClick={() => selectTutor(r)}>
                  {r.fullName} · next {formatDayLabel(r.nextFreeSlot!)} {formatTime(r.nextFreeSlot!)}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground mt-1">
              No other {data.subject.name} tutor is free in this period. Try later dates.
            </p>
          )}
        </div>
      )}

      {/* Date window navigation */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Available times{" "}
          <span className="text-muted-foreground font-normal">
            ({formatDayLabel(data.range.from)} – {formatDayLabel(new Date(new Date(data.range.to).getTime() - 1).toISOString())}, Melbourne time)
          </span>
        </p>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="text-muted-foreground size-4 animate-spin" />}
          <Button type="button" size="icon" variant="ghost" aria-label="Earlier dates"
            disabled={windowOffset === 0} onClick={() => setWindowOffset((w) => w - 1)}>
            <ChevronLeft className="size-4" />
          </Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Later dates"
            disabled={windowOffset >= 3} onClick={() => setWindowOffset((w) => w + 1)}>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Slots */}
      {!tutorId ? (
        <p className="text-muted-foreground text-sm">Choose a tutor to see their free times.</p>
      ) : slotsByDay.length === 0 ? (
        <p className="text-muted-foreground text-sm">No free times in this period.</p>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {slotsByDay.map(([day, slots]) => (
            <div key={day}>
              <p className="text-muted-foreground mb-1 text-xs font-medium uppercase">{formatDayLabel(slots[0])}</p>
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <Button key={slot} type="button" size="sm"
                    variant={slot === scheduledAt ? "default" : "outline"}
                    aria-pressed={slot === scheduledAt}
                    onClick={() => onSlotChange(slot)}>
                    {formatTime(slot)}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {scheduledAt && (
        <p className="text-sm">
          Selected: <span className="font-medium">{formatDateTime(scheduledAt)}</span>
          {selected && <> with <span className="font-medium">{selected.fullName}</span></>}
        </p>
      )}
    </div>
  );
}
