"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, List, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
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
    <div className="bg-muted text-muted-foreground inline-flex rounded-md p-1 text-sm" role="tablist">
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

/** List | Calendar switch (D47), kept in the URL like the other filters. */
export function ViewToggle({ current }: { current: "list" | "calendar" }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (view: "list" | "calendar") => {
    const next = new URLSearchParams(params);
    if (view === "list") {
      next.delete("view");
      next.delete("week");
    } else next.set("view", view);
    return `${pathname}?${next}`;
  };
  return (
    <div className="bg-muted text-muted-foreground inline-flex rounded-md p-1 text-sm" role="tablist" aria-label="View">
      {(["list", "calendar"] as const).map((v) => (
        <Link
          key={v}
          href={href(v)}
          role="tab"
          aria-selected={current === v}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-medium transition-colors",
            current === v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
          )}
        >
          {v === "list" ? <List className="size-4" /> : <CalendarDays className="size-4" />}
          {v === "list" ? "List" : "Calendar"}
        </Link>
      ))}
    </div>
  );
}

const ANY = "any";

const SEARCH_DEBOUNCE_MS = 300;

/** Admin filters: student name search, subject, tutor and sort order, kept in the URL. */
export function AdminFilters({ subjects }: { subjects: SubjectDto[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const set = (key: string, value: string, mode: "push" | "replace" = "push") => {
    const next = new URLSearchParams(params);
    if (value === ANY || value === "") next.delete(key);
    else next.set(key, value);
    if (key === "subjectId") next.delete("tutorId"); // tutor list depends on subject
    router[mode](`${pathname}?${next}`);
  };

  // Search as you type, debounced. `replace` so each keystroke isn't a history entry.
  const onSearchChange = (value: string) => {
    setSearch(value);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => set("q", value.trim(), "replace"), SEARCH_DEBOUNCE_MS);
  };

  const subjectId = params.get("subjectId") ?? ANY;
  const tutors = subjectId === ANY
    ? subjects.flatMap((s) => s.tutors).filter((t, i, all) => all.findIndex((x) => x.id === t.id) === i)
    : (subjects.find((s) => s.id === subjectId)?.tutors ?? []);

  return (
    <div className="mb-4 flex flex-wrap gap-3">
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
        <Input
          type="search"
          placeholder="Search student name"
          aria-label="Search by student name"
          className="pl-8"
          maxLength={100}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
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
