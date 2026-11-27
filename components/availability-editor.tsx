"use client";

import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { HOURS, WEEKDAYS, cellKey, cellsToWindows, sameCells, windowsToCells } from "@/lib/availability-grid";
import type { AvailabilityConflictDetails, TutorScheduleDto } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

/**
 * Weekly availability grid (D46). Click or drag across hours to switch them on
 * or off, then save the whole week with one PUT. Hours that hold upcoming
 * sessions are locked on: the server refuses to remove them (409), and the
 * grid says so up front.
 */
export function AvailabilityEditor({ initial }: { initial: TutorScheduleDto }) {
  const [saved, setSaved] = useState(() => windowsToCells(initial.windows));
  const [cells, setCells] = useState(saved);
  const [booked, setBooked] = useState(() => new Map(initial.booked.map((b) => [cellKey(b.weekday, b.hour), b.count])));
  const [conflicts, setConflicts] = useState<AvailabilityConflictDetails["conflicts"]>([]);
  const [saving, setSaving] = useState(false);

  // Drag painting: the first cell decides whether the drag switches on or off.
  const paint = useRef<boolean | null>(null);
  useEffect(() => {
    const stop = () => (paint.current = null);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, []);

  const apply = (key: string, on: boolean) => {
    if (!on && booked.has(key)) return; // booked hours stay on
    setCells((prev) => {
      if (prev.has(key) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const setDay = (weekday: number, on: boolean) => HOURS.forEach((h) => apply(cellKey(weekday, h), on));

  const dirty = !sameCells(cells, saved);
  const hoursOn = cells.size;

  const save = async () => {
    setSaving(true);
    setConflicts([]);
    try {
      const schedule = await apiFetch<TutorScheduleDto>("/api/tutor/availability", {
        method: "PUT",
        body: { windows: cellsToWindows(cells) },
      });
      const next = windowsToCells(schedule.windows);
      setSaved(next);
      setCells(next);
      setBooked(new Map(schedule.booked.map((b) => [cellKey(b.weekday, b.hour), b.count])));
      toast.success("Availability saved.");
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "availability_conflict") {
        // Someone booked an hour since this page loaded: refresh the locks.
        setConflicts((e.details as AvailabilityConflictDetails | undefined)?.conflicts ?? []);
        const fresh = await apiFetch<TutorScheduleDto>("/api/tutor/availability").catch(() => null);
        if (fresh) setBooked(new Map(fresh.booked.map((b) => [cellKey(b.weekday, b.hour), b.count])));
      }
      toast.error(e instanceof ApiClientError ? e.message : "Could not save availability.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5"><span className="bg-primary size-3 rounded-sm" /> Available</span>
        <span className="flex items-center gap-1.5"><span className="bg-background size-3 rounded-sm border" /> Unavailable</span>
        <span className="flex items-center gap-1.5"><Lock className="size-3" /> Has upcoming sessions (can&apos;t be removed)</span>
      </div>

      {conflicts.length > 0 && (
        <div className="border-destructive/50 bg-destructive/10 rounded-md border p-3 text-sm">
          <p className="font-medium">Not saved. These upcoming sessions fall in hours you removed:</p>
          <ul className="mt-1 list-disc pl-5">
            {conflicts.map((c) => <li key={c.id}>{formatDateTime(c.scheduledAt)}</li>)}
          </ul>
          <p className="text-muted-foreground mt-1">Those hours are now locked on. Keep them until the students reschedule or cancel.</p>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <div
          className="grid min-w-[40rem] touch-none select-none grid-cols-[4rem_repeat(7,minmax(0,1fr))] text-sm"
          role="group"
          aria-label="Weekly availability"
        >
          <div className="bg-muted/50 border-b" />
          {WEEKDAYS.map(([weekday, label]) => {
            const allOn = HOURS.every((h) => cells.has(cellKey(weekday, h)));
            return (
              <div key={weekday} className="bg-muted/50 border-b border-l px-1 py-1.5 text-center">
                <div className="font-medium">{label}</div>
                <button
                  type="button"
                  onClick={() => setDay(weekday, !allOn)}
                  className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
                >
                  {allOn ? "Clear" : "All day"}
                </button>
              </div>
            );
          })}

          {HOURS.map((h) => (
            <div key={h} className="contents">
              <div className="text-muted-foreground border-b px-2 py-1 text-right text-xs">{hourLabel(h)}</div>
              {WEEKDAYS.map(([weekday, label]) => {
                const key = cellKey(weekday, h);
                const on = cells.has(key);
                const count = booked.get(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${label} ${hourLabel(h)}: ${on ? "available" : "unavailable"}${count ? `, ${count} upcoming session${count > 1 ? "s" : ""}` : ""}`}
                    title={count ? `${count} upcoming session${count > 1 ? "s" : ""} at this time` : undefined}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      paint.current = !on;
                      apply(key, !on);
                    }}
                    onPointerEnter={() => paint.current !== null && apply(key, paint.current)}
                    // Keyboard (Enter/Space) toggles; pointer input is handled above.
                    onClick={(e) => e.detail === 0 && apply(key, !on)}
                    className={cn(
                      "flex h-9 items-center justify-center border-b border-l transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      on ? "bg-primary text-primary-foreground hover:bg-primary/90" : "hover:bg-accent",
                      count && !on && "bg-destructive/20",
                      count && "cursor-not-allowed",
                    )}
                  >
                    {count ? <Lock className="size-3" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {hoursOn} hour{hoursOn === 1 ? "" : "s"} a week{dirty && " · unsaved changes"}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={!dirty || saving} onClick={() => { setCells(saved); setConflicts([]); }}>
            Reset
          </Button>
          <Button type="button" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save availability"}
          </Button>
        </div>
      </div>
    </div>
  );
}
