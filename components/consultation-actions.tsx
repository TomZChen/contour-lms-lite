"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AvailabilityPicker } from "@/components/availability-picker";
import { apiFetch, ApiClientError, SLOT_ERROR_CODES } from "@/lib/api-client";
import type { ConsultationDto } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";

type Props = { consultation: ConsultationDto; onUpdated: (c: ConsultationDto) => void };

const errorMessage = (e: unknown) => (e instanceof ApiClientError ? e.message : "Something went wrong.");

/** Complete / reschedule / cancel controls for a student's own consultation. */
export function StudentActions({ consultation: c, onUpdated }: Props) {
  if (c.status === "cancelled") return <span className="text-muted-foreground text-xs">No actions</span>;

  return (
    <TooltipProvider>
      <div className="flex items-center justify-end gap-2">
        <CompletionToggle consultation={c} onUpdated={onUpdated} />
        {c.status === "scheduled" && <RescheduleDialog consultation={c} onUpdated={onUpdated} />}
        <CancelButton consultation={c} onUpdated={onUpdated} />
      </div>
    </TooltipProvider>
  );
}

/** Mirrors the rules in the API and RLS: only once ended (D16). */
function CompletionToggle({ consultation: c, onUpdated }: Props) {
  const [pending, setPending] = useState(false);
  // Evaluated at render; the API re-checks against server time.
  // eslint-disable-next-line react-hooks/purity
  const ended = new Date(c.endsAt).getTime() <= Date.now();
  const checked = c.status === "completed";

  const toggle = async () => {
    setPending(true);
    try {
      const updated = await apiFetch<ConsultationDto>(`/api/consultations/${c.id}/completion`, {
        method: checked ? "DELETE" : "PUT",
      });
      onUpdated(updated);
      toast.success(checked ? "Marked as incomplete." : "Marked as complete.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  const box = (
    <label className="flex items-center gap-1.5 text-xs">
      <Checkbox checked={checked} disabled={pending || (!ended && !checked)} onCheckedChange={toggle} />
      Done
    </label>
  );

  if (ended || checked) return box;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>{box}</span>
      </TooltipTrigger>
      <TooltipContent>You can mark it complete once it has ended.</TooltipContent>
    </Tooltip>
  );
}

function RescheduleDialog({ consultation: c, onUpdated }: Props) {
  const [open, setOpen] = useState(false);
  const [tutorId, setTutorId] = useState(c.tutor.id);
  const [scheduledAt, setScheduledAt] = useState<string>();
  const [pending, setPending] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const submit = async () => {
    if (!scheduledAt) return;
    setPending(true);
    try {
      const updated = await apiFetch<ConsultationDto>(`/api/consultations/${c.id}/reschedule`, {
        method: "POST",
        body: { scheduledAt, ...(tutorId !== c.tutor.id ? { tutorId } : {}) },
      });
      onUpdated(updated);
      toast.success(`Rescheduled to ${formatDateTime(updated.scheduledAt)}.`);
      setOpen(false);
    } catch (e) {
      toast.error(errorMessage(e));
      if (e instanceof ApiClientError && SLOT_ERROR_CODES.has(e.code)) {
        setScheduledAt(undefined);
        setRefreshKey((k) => k + 1);
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setTutorId(c.tutor.id);
          setScheduledAt(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Reschedule</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reschedule {c.subject.name}</DialogTitle>
          <DialogDescription>
            Currently {formatDateTime(c.scheduledAt)} with {c.tutor.fullName}. Pick a new time, or another{" "}
            {c.subject.name} tutor.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AvailabilityPicker
            subjectId={c.subject.id}
            tutorId={tutorId}
            scheduledAt={scheduledAt}
            onTutorChange={setTutorId}
            onSlotChange={setScheduledAt}
            refreshKey={refreshKey}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Keep current time</Button>
          <Button onClick={submit} disabled={!scheduledAt || pending}>
            {pending ? "Saving…" : "Confirm new time"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelButton({ consultation: c, onUpdated }: Props) {
  const [pending, setPending] = useState(false);

  // D15: completed consultations must be marked incomplete before cancelling.
  if (c.status === "completed") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button size="sm" variant="ghost" disabled>Cancel</Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Mark it incomplete first to cancel.</TooltipContent>
      </Tooltip>
    );
  }

  const cancel = async () => {
    setPending(true);
    try {
      onUpdated(await apiFetch<ConsultationDto>(`/api/consultations/${c.id}/cancel`, { method: "POST" }));
      toast.success("Consultation cancelled.");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={pending}>Cancel</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel this consultation?</AlertDialogTitle>
          <AlertDialogDescription>
            {c.subject.name} with {c.tutor.fullName} on {formatDateTime(c.scheduledAt)}. The slot is released for
            other students. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction onClick={cancel}>Cancel consultation</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
