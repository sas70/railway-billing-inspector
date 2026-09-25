"use client";

import { useId } from "react";

import type { StatusFilter } from "@/lib/service-stats";
import { Icon } from "./Icon";

export function ServicesToolbar({
  query,
  filter,
  onQuery,
  onFilter,
  visible,
  total,
  actions,
}: {
  query: string;
  filter: StatusFilter;
  onQuery: (query: string) => void;
  onFilter: (filter: StatusFilter) => void;
  visible: number;
  total: number;
  actions?: React.ReactNode;
}) {
  const searchId = useId();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
      <div className="relative w-full min-w-0 sm:max-w-sm sm:flex-1">
        <label className="sr-only" htmlFor={searchId}>
          Search services
        </label>
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-3 text-ink-2" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search service, project, workspace…"
          className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-3 text-sm placeholder:text-ink-2 focus:border-[var(--series-1)]"
        />
      </div>
      <div className="flex rounded-lg border border-line bg-page p-1 text-xs" role="group" aria-label="Status filter">
        {(
          [
            ["all", "All"],
            ["online", "Online"],
            ["offline", "Offline"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => onFilter(id)}
            className={`rounded-md px-3 py-1.5 font-medium ${filter === id ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-2" role="status">{visible === total ? `${total} services` : `${visible} of ${total}`}</span>
        {actions}
      </div>
    </div>
  );
}
