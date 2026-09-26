"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { ActionButton } from "@/components/ActionReview";
import { Icon } from "@/components/Icon";
import { RailwayLink } from "@/components/RailwayLink";
import { Badge, EmptyState, HealthPill, Money } from "@/components/ui";
import type { ServiceCatalogRow } from "@/lib/service-row";
import { railwayServiceUrl } from "@/lib/railway-links";
import {
  DEFAULT_SERVICE_SORT,
  nextServiceSort,
  sortServiceRows,
  type ServiceSort,
  type ServiceSortKey,
} from "@/lib/service-stats";

function lockReason(row: ServiceCatalogRow, readOnly: boolean): string | undefined {
  if (readOnly) return "Read-only — enable Write mode in the header";
  if (row.protected) return "This project is protected (PROTECTED_PROJECTS)";
  return undefined;
}

function SortHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: ServiceSortKey;
  sort: ServiceSort;
  onSort: (column: ServiceSortKey) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === column;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-2 py-2 font-medium ${align === "right" ? "text-right" : "text-left"} ${column === "service" ? "px-4" : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-1 rounded-sm hover:text-ink ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-ink" : ""}`}
      >
        {label}
        <Icon
          name="chevron"
          size={11}
          className={active ? (sort.dir === "desc" ? "rotate-90" : "-rotate-90") : "rotate-90 opacity-30"}
        />
      </button>
    </th>
  );
}

export function ServicesTable({ rows, readOnly }: { rows: ServiceCatalogRow[]; readOnly: boolean }) {
  const [sort, setSort] = useState(DEFAULT_SERVICE_SORT);
  const sorted = useMemo(() => sortServiceRows(rows, sort), [rows, sort]);
  const allEnvsNote = rows.some((r) => r.costIsAllEnvs);

  function onSort(column: ServiceSortKey) {
    setSort((current) => nextServiceSort(current, column));
  }

  return (
    <div>
      {sorted.length === 0 ? (
        <EmptyState>No services in any workspace.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <SortHeader label="Service" column="service" sort={sort} onSort={onSort} />
                <SortHeader label="Status" column="status" sort={sort} onSort={onSort} />
                <SortHeader label="Environment" column="environment" sort={sort} onSort={onSort} />
                <SortHeader label="Latest deploy" column="latest" sort={sort} onSort={onSort} />
                <SortHeader label="This period" column="period" sort={sort} onSort={onSort} align="right" />
                <SortHeader label="Expected" column="expected" sort={sort} onSort={onSort} align="right" />
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const lock = lockReason(row, readOnly);
                const canOff = row.online && row.liveDeploymentIds.length > 0 && row.health !== "deploying";
                const offReason =
                  lock ??
                  (row.health === "deploying"
                    ? "Still deploying — wait or cancel the build on the service page"
                    : row.online
                      ? "No live deployment to take down"
                      : undefined);
                const canOn = !row.online;
                const onReason = lock;
                const search = `${row.serviceName} ${row.projectName} ${row.workspaceName} ${row.environmentName}`.toLowerCase();

                return (
                  <tr
                    key={row.key}
                    data-service-row
                    data-online={row.online ? "1" : "0"}
                    data-search={search}
                    className="border-b border-line last:border-b-0 hover:bg-surface-2"
                  >
                    <td className="px-4 py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Link href={row.href} className="font-medium hover:underline underline-offset-2">
                          {row.serviceName}
                        </Link>
                        <RailwayLink
                          href={railwayServiceUrl(row.projectId, row.serviceId, row.environmentId)}
                          compact
                        />
                      </div>
                      <div className="mt-0.5 text-xs text-ink-2">
                        {row.workspaceName} · {row.projectName}
                      </div>
                      {row.protected && (
                        <div className="mt-1">
                          <Badge title="Listed in PROTECTED_PROJECTS">
                            <Icon name="lock" size={10} /> protected
                          </Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <div className="text-xs font-medium">{row.online ? "Online" : "Offline"}</div>
                      <div className="mt-1">
                        <HealthPill health={row.health} degraded={row.degraded} />
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs text-ink-2">
                      {row.environmentName}
                      {row.isPrimary && <div>(primary)</div>}
                      {row.isEphemeral && <div>PR environment</div>}
                    </td>
                    <td className="px-2 py-2.5 align-top text-xs text-ink-2">{row.latestLabel}</td>
                    <td className="px-2 py-2.5 text-right align-top">
                      <Money value={row.periodCost} />
                    </td>
                    <td className="px-2 py-2.5 text-right align-top font-medium">
                      <Money value={row.expectedCost} />
                    </td>
                    <td className="px-4 py-2.5 text-right align-top">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {row.online ? (
                          <ActionButton
                            label="Turn off"
                            icon="power"
                            tone="neutral"
                            disabled={!canOff || !!lock}
                            disabledReason={offReason}
                            request={{
                              accountKey: row.accountKey,
                              kind: "deployment.remove",
                              projectId: row.projectId,
                              serviceId: row.serviceId,
                              environmentId: row.environmentId,
                              targetIds: row.liveDeploymentIds,
                            }}
                          />
                        ) : (
                          <ActionButton
                            label="Turn on"
                            icon="power"
                            tone="primary"
                            disabled={!canOn || !!lock}
                            disabledReason={onReason}
                            request={{
                              accountKey: row.accountKey,
                              kind: "deployment.redeploy",
                              projectId: row.projectId,
                              serviceId: row.serviceId,
                              environmentId: row.environmentId,
                              targetIds: row.latestId ? [row.latestId] : [],
                            }}
                          />
                        )}
                        <Link
                          href={row.href}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink"
                        >
                          Open <Icon name="chevron" size={12} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {allEnvsNote && (
        <p className="border-t border-line px-4 py-2 text-xs text-ink-2">
          Some workspaces only return usage per service (not per environment), so those costs are the service total across every
          environment.
        </p>
      )}
    </div>
  );
}
