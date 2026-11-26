"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STATUS_BADGE } from "@/components/consultation-list";
import { StudentActions } from "@/components/consultation-actions";
import { addDays, localParts, weekRange } from "@/lib/calendar";
import type { ConsultationDto, ConsultationStatus } from "@/lib/dto";
import { formatDateTime, formatTime } from "@/lib/format";
import { BUSINESS_CLOSE_HOUR, BUSINESS_OPEN_HOUR } from "@/lib/validation";
import { cn } from "@/lib/utils";

type Mode = "student" | "tutor" | "admin";

type Props = {
  mode: Mode;
  /** Monday of the week shown, "YYYY-MM-DD" in Melbourne time. */
  weekKey: string;
  /** Today in Melbourne time (computed on the server so renders match). */
  todayKey: string;
  items: ConsultationDto[];
  /** More sessions matched than the calendar shows. */
  truncated: boolean;
};

/** Chips shown per hour cell before "+n more". */
const MAX_PER_CELL = 2;

const CHIP_STYLE: Record<ConsultationStatus, string> = {
  scheduled: "border-primary/40 bg-primary/10 hover:bg-primary/20",
  completed: "border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20",
  cancelled: "border-border bg-muted text-muted-foreground line-through hover:bg-muted/70",
};

const weekLabelFmt = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayHeaderFmt = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
// Date keys are already Melbourne dates; format them as plain dates (UTC).
const keyToUtcDate = (key: string) => new Date(`${key}T00:00:00Z`);
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;

/** The main line of a chip, from the viewer's point of view. */
function chipTitle(mode: Mode, c: ConsultationDto) {
  if (mode === "student") return c.subject.name;
  return `${c.firstName} ${c.lastName}`;
}
function chipSubtitle(mode: Mode, c: ConsultationDto) {
  if (mode === "student") return c.tutor.fullName ?? "Tutor";
  if (mode === "tutor") return c.subject.name;
  return `${c.subject.name} · ${c.tutor.fullName ?? "Tutor"}`;
}

/**
 * Week view of consultations (D47): Monday to Sunday × business hours, in
 * Melbourne time. Every session is 60 minutes and starts on the hour, so each
 * one sits in exactly one cell. Week navigation lives in the URL (`?week=`),
 * so the server renders each week with the page's usual filters.
 */
export function WeekCalendar({ mode, weekKey, todayKey, items, truncated }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selectedId, setSelectedId] = useState<string>();
  const [overflowCell, setOverflowCell] = useState<string>();

  const { days } = weekRange(weekKey);

  // Bucket sessions by "dateKey|hour".
  const cells = new Map<string, ConsultationDto[]>();
  const hours = new Set<number>();
  for (let h = BUSINESS_OPEN_HOUR; h < BUSINESS_CLOSE_HOUR; h++) hours.add(h);
  for (const c of items) {
    const { dateKey, hour } = localParts(c.scheduledAt);
    const k = `${dateKey}|${hour}`;
    cells.set(k, [...(cells.get(k) ?? []), c]);
    hours.add(hour); // historic data outside today's business hours still shows
  }
  const rows = [...hours].sort((a, b) => a - b);

  const weekHref = (key: string | null) => {
    const next = new URLSearchParams(params);
    if (key) next.set("week", key);
    else next.delete("week");
    return `${pathname}?${next}`;
  };

  const selected = items.find((c) => c.id === selectedId);
  const overflow = overflowCell ? (cells.get(overflowCell) ?? []) : [];


  const chip = (c: ConsultationDto) => (
    <button
      key={c.id}
      type="button"
      onClick={() => {
        setOverflowCell(undefined);
        setSelectedId(c.id);
      }}
      className={cn("w-full truncate rounded border px-1.5 py-0.5 text-left text-xs transition-colors", CHIP_STYLE[c.status])}
      title={`${formatTime(c.scheduledAt)} ${chipTitle(mode, c)} · ${chipSubtitle(mode, c)} (${STATUS_BADGE[c.status].label})`}
    >
      <span className="font-medium">{chipTitle(mode, c)}</span>
      <span className="text-muted-foreground block truncate">{chipSubtitle(mode, c)}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {weekLabelFmt.format(keyToUtcDate(weekKey))} – {weekLabelFmt.format(keyToUtcDate(addDays(weekKey, 6)))}
          <span className="text-muted-foreground font-normal"> · Melbourne time</span>
        </p>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost" size="icon" aria-label="Previous week">
            <Link href={weekHref(addDays(weekKey, -7))}><ChevronLeft className="size-4" /></Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={weekHref(null)}>This week</Link>
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Next week">
            <Link href={weekHref(addDays(weekKey, 7))}><ChevronRight className="size-4" /></Link>
          </Button>
        </div>
      </div>

      {truncated && (
        <p className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
          This week has more sessions than the calendar can show. Narrow it down with the filters.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <div className="grid min-w-[56rem] grid-cols-[4rem_repeat(7,minmax(0,1fr))] text-sm">
          {/* Header row */}
          <div className="bg-muted/50 border-b" />
          {days.map((d) => (
            <div
              key={d}
              className={cn(
                "bg-muted/50 border-b border-l px-2 py-2 text-center font-medium",
                d === todayKey && "text-primary",
              )}
            >
              {dayHeaderFmt.format(keyToUtcDate(d))}
              {d === todayKey && <span className="ml-1 text-xs">(today)</span>}
            </div>
          ))}

          {/* Hour rows */}
          {rows.map((h) => (
            <div key={h} className="contents">
              <div className="text-muted-foreground border-b px-2 py-1 text-right text-xs">{hourLabel(h)}</div>
              {days.map((d) => {
                const key = `${d}|${h}`;
                const list = cells.get(key) ?? [];
                const shown = list.slice(0, MAX_PER_CELL);
                return (
                  <div
                    key={key}
                    className={cn("min-h-14 space-y-1 border-b border-l p-1", d === todayKey && "bg-primary/5")}
                  >
                    {shown.map(chip)}
                    {list.length > MAX_PER_CELL && (
                      <button
                        type="button"
                        onClick={() => setOverflowCell(key)}
                        className="text-muted-foreground hover:text-foreground w-full text-left text-xs underline-offset-2 hover:underline"
                      >
                        +{list.length - MAX_PER_CELL} more
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {items.length === 0 && (
        <p className="text-muted-foreground text-center text-sm">No sessions this week.</p>
      )}

      {/* All sessions in a busy cell */}
      <Dialog open={overflow.length > 0} onOpenChange={(open) => !open && setOverflowCell(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{overflow[0] && formatDateTime(overflow[0].scheduledAt)}</DialogTitle>
            <DialogDescription>{overflow.length} sessions at this time.</DialogDescription>
          </DialogHeader>
          <div className="max-h-96 space-y-1 overflow-y-auto">{overflow.map(chip)}</div>
        </DialogContent>
      </Dialog>

      {/* One session's details (and, for students, its actions) */}
      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(undefined)}>
        <DialogContent>
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.subject.name}</DialogTitle>
                <DialogDescription>{formatDateTime(selected.scheduledAt)} · 60 minutes</DialogDescription>
              </DialogHeader>
              <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd><Badge variant={STATUS_BADGE[selected.status].variant}>{STATUS_BADGE[selected.status].label}</Badge></dd>
                <dt className="text-muted-foreground">Tutor</dt>
                <dd>{selected.tutor.fullName}</dd>
                <dt className="text-muted-foreground">Student</dt>
                <dd>{selected.firstName} {selected.lastName}</dd>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="whitespace-pre-wrap break-words">{selected.reason}</dd>
              </dl>
              {mode === "student" && (
                <div className="flex justify-end border-t pt-4">
                  {/* After a change, re-render the week from the server. */}
                  <StudentActions consultation={selected} onUpdated={() => router.refresh()} />
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
