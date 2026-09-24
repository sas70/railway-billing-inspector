"use client";

import { useId } from "react";

import type { StatusFilter } from "@/lib/service-stats";

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
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      <label className="sr-only" htmlFor={searchId}>
        Search services
      </label>
      <input
        id={searchId}
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search service, project, workspace…"
        className="h-8 w-full min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 text-sm outline-none placeholder:text-ink-2 focus:border-[var(--series-1)] sm:max-w-xs"
      />
      <div className="flex rounded-md border border-line p-0.5 text-xs" role="group" aria-label="Status filter">
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
            className={`rounded px-2.5 py-1 font-medium ${filter === id ? "bg-surface-2 text-ink" : "text-ink-2 hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-ink-2">{visible === total ? `${total} services` : `${visible} of ${total}`}</span>
        {actions}
      </div>
    </div>
  );
}
