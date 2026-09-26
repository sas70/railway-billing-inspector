"use client";

import { useEffect, useId, useState } from "react";

import { Icon } from "@/components/Icon";

export function OverviewSearch({ totalProjects }: { totalProjects: number }) {
  const searchId = useId();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  useEffect(() => {
    const rows = document.querySelectorAll<HTMLTableRowElement>("[data-project-row]");
    let visible = 0;
    for (const row of rows) {
      const hay = row.dataset.search ?? "";
      const hide = q.length > 0 && !hay.includes(q);
      row.hidden = hide;
      if (!hide) visible++;
    }
    for (const section of document.querySelectorAll<HTMLElement>("[data-workspace-section]")) {
      const any = [...section.querySelectorAll<HTMLTableRowElement>("[data-project-row]")].some((row) => !row.hidden);
      section.hidden = q.length > 0 && !any;
    }
    const status = document.getElementById("overview-search-status");
    if (status) {
      status.textContent = q ? `${visible} of ${totalProjects} projects` : `${totalProjects} projects`;
    }
  }, [q, totalProjects]);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative w-full min-w-0 sm:max-w-md sm:flex-1">
        <label className="sr-only" htmlFor={searchId}>
          Search projects across all workspaces
        </label>
        <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-3 text-ink-2" />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search all workspaces: project, domain, service…"
          className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-3 text-sm placeholder:text-ink-2 focus:border-(--series-1)"
        />
      </div>
      <span id="overview-search-status" className="text-xs text-ink-2" role="status">
        {totalProjects} projects
      </span>
    </div>
  );
}
