import Link from "next/link";

import { ActionButton } from "@/components/ActionReview";
import { Icon } from "@/components/Icon";
import { Badge, EmptyState, HealthPill, Money } from "@/components/ui";
import type { ServiceCatalogRow } from "@/lib/service-row";

function lockReason(row: ServiceCatalogRow, readOnly: boolean): string | undefined {
  if (readOnly) return "Read-only — enable Write mode in the header";
  if (row.protected) return "This project is protected (PROTECTED_PROJECTS)";
  return undefined;
}

export function ServicesTable({ rows, readOnly }: { rows: ServiceCatalogRow[]; readOnly: boolean }) {
  const allEnvsNote = rows.some((r) => r.costIsAllEnvs);

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyState>No services in any workspace.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th scope="col" className="px-4 py-2 font-medium">
                  Service
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Environment
                </th>
                <th scope="col" className="px-2 py-2 font-medium">
                  Latest deploy
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  This period
                </th>
                <th scope="col" className="px-2 py-2 text-right font-medium">
                  Expected
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
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
                      <Link href={row.href} className="font-medium hover:underline underline-offset-2">
                        {row.serviceName}
                      </Link>
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
