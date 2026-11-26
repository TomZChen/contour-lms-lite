"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SubjectDto } from "@/lib/dto";
import { cn } from "@/lib/utils";

const STATUS_TABS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
] as const;

/** Status tabs as links, so the filter lives in the URL and the server renders it. */
export function StatusTabs({ current }: { current: string }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <div className="bg-muted text-muted-foreground mb-4 inline-flex rounded-md p-1 text-sm" role="tablist">
      {STATUS_TABS.map((t) => {
        const next = new URLSearchParams(params);
        next.set("status", t.value);
        return (
          <Link
            key={t.value}
            href={`${pathname}?${next}`}
            role="tab"
            aria-selected={current === t.value}
            className={cn(
              "rounded-sm px-3 py-1.5 font-medium transition-colors",
              current === t.value ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

const ANY = "any";

/** Admin filters: subject, tutor and sort order, kept in the URL. */
export function AdminFilters({ subjects }: { subjects: SubjectDto[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === ANY) next.delete(key);
    else next.set(key, value);
    if (key === "subjectId") next.delete("tutorId"); // tutor list depends on subject
    router.push(`${pathname}?${next}`);
  };

  const subjectId = params.get("subjectId") ?? ANY;
  const tutors = subjectId === ANY
    ? subjects.flatMap((s) => s.tutors).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    : (subjects.find((s) => s.id === subjectId)?.tutors ?? []);

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      <Select value={subjectId} onValueChange={(v) => set("subjectId", v)}>
        <SelectTrigger className="w-48" aria-label="Subject"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All subjects</SelectItem>
          {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={params.get("tutorId") ?? ANY} onValueChange={(v) => set("tutorId", v)}>
        <SelectTrigger className="w-48" aria-label="Tutor"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>All tutors</SelectItem>
          {tutors
            .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""))
            .map((t) => <SelectItem key={t.id} value={t.id}>{t.fullName}</SelectItem>)}
        </SelectContent>
      </Select>
      <Select value={params.get("order") ?? "desc"} onValueChange={(v) => set("order", v)}>
        <SelectTrigger className="w-44" aria-label="Sort order"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="desc">Latest first</SelectItem>
          <SelectItem value="asc">Earliest first</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
