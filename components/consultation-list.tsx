"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { ConsultationDto, ConsultationStatus, Page } from "@/lib/dto";
import { formatDateTime } from "@/lib/format";
import { StudentActions } from "./consultation-actions";

type Mode = "student" | "tutor" | "admin";

export const STATUS_BADGE: Record<ConsultationStatus, { label: string; variant: "default" | "secondary" | "outline" }> = {
  scheduled: { label: "Scheduled", variant: "outline" },
  completed: { label: "Completed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

type Props = {
  mode: Mode;
  initial: Page<ConsultationDto>;
  /** API list endpoint used for "Load more" (same filters as the server render). */
  endpoint: "/api/consultations" | "/api/admin/consultations";
  /** Current filters, sent with every "Load more" request. */
  query: Record<string, string>;
  /** Status filter in effect, so rows that leave it can be removed. */
  status?: ConsultationStatus;
  emptyMessage: string;
};

/**
 * Consultation table shared by the student, tutor and admin areas. The first
 * page is server-rendered (D29); further pages come from the API using the
 * keyset cursor (D30). Student mutations update rows in place from the API
 * response.
 */
export function ConsultationList({ mode, initial, endpoint, query, status, emptyMessage }: Props) {
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<Page<ConsultationDto>>(
        `${endpoint}?${new URLSearchParams({ ...query, cursor })}`,
      );
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : "Could not load more consultations.");
    } finally {
      setLoadingMore(false);
    }
  };

  const onUpdated = (updated: ConsultationDto) =>
    setItems((prev) =>
      status && updated.status !== status
        ? prev.filter((c) => c.id !== updated.id) // no longer matches the filter
        : prev.map((c) => (c.id === updated.id ? updated : c)),
    );

  if (items.length === 0) {
    return <p className="text-muted-foreground rounded-md border p-8 text-center text-sm">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Subject</TableHead>
              {mode !== "tutor" && <TableHead>Tutor</TableHead>}
              {mode !== "student" && <TableHead>Student</TableHead>}
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              {mode === "student" && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((c) => (
              <TableRow key={c.id} className={c.status === "cancelled" ? "text-muted-foreground" : undefined}>
                <TableCell className="whitespace-nowrap">{formatDateTime(c.scheduledAt)}</TableCell>
                <TableCell>{c.subject.name}</TableCell>
                {mode !== "tutor" && <TableCell>{c.tutor.fullName}</TableCell>}
                {mode !== "student" && <TableCell>{c.firstName} {c.lastName}</TableCell>}
                <TableCell className="max-w-xs truncate" title={c.reason}>{c.reason}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[c.status].variant}>{STATUS_BADGE[c.status].label}</Badge>
                </TableCell>
                {mode === "student" && (
                  <TableCell className="text-right">
                    <StudentActions consultation={c} onUpdated={onUpdated} />
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {cursor && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
