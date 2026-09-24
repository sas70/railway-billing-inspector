"use client";

import { useMemo, useState } from "react";

import type { PlanKind, PlanRequest } from "@/lib/plan-types";
import type { DeploymentStatus } from "@/lib/railway/types";
import { ReviewDialog } from "./ActionReview";
import { buttonClass } from "./button";
import { Icon, type IconName } from "./Icon";
import { LogsPanel } from "./LogsPanel";

export type DeploymentRowView = {
  id: string;
  shortId: string;
  status: DeploymentStatus;
  createdLabel: string;
  createdRelative: string;
  message?: string;
  branch?: string;
  commit?: string;
  author?: string;
  reason?: string;
  image?: string;
  isLive: boolean;
  canRedeploy: boolean;
  canRollback: boolean;
};

const IN_PROGRESS = new Set<DeploymentStatus>(["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING", "NEEDS_APPROVAL"]);
const GONE = new Set<DeploymentStatus>(["REMOVED", "REMOVING"]);
const PROBLEM = new Set<DeploymentStatus>(["FAILED", "CRASHED"]);

type Filter = "all" | "running" | "problems" | "removed";

const STATUS_STYLE: Record<string, { label: string; icon: IconName; color: string }> = {
  SUCCESS: { label: "Success", icon: "check", color: "var(--status-good)" },
  SLEEPING: { label: "Sleeping", icon: "moon", color: "var(--ink-2)" },
  CRASHED: { label: "Crashed", icon: "alert", color: "var(--status-critical)" },
  FAILED: { label: "Failed", icon: "x", color: "var(--status-critical)" },
  REMOVED: { label: "Removed", icon: "circle", color: "var(--ink-muted)" },
  REMOVING: { label: "Removing", icon: "circle", color: "var(--ink-muted)" },
  SKIPPED: { label: "Skipped", icon: "circle", color: "var(--ink-muted)" },
};

function statusStyle(status: DeploymentStatus) {
  if (IN_PROGRESS.has(status)) {
    return { label: status.charAt(0) + status.slice(1).toLowerCase().replace("_", " "), icon: "loader" as IconName, color: "var(--status-warning)" };
  }
  return STATUS_STYLE[status] ?? { label: status, icon: "circle" as IconName, color: "var(--ink-muted)" };
}

export function DeploymentHistory({
  accountKey,
  projectId,
  serviceId,
  environmentId,
  rows,
  readOnly,
  protectedProject,
}: {
  accountKey: string;
  projectId: string;
  serviceId: string;
  environmentId: string;
  rows: DeploymentRowView[];
  readOnly: boolean;
  protectedProject: boolean;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PlanRequest | null>(null);
  const [logsFor, setLogsFor] = useState<DeploymentRowView | null>(null);

  const counts = useMemo(
    () => ({
      all: rows.length,
      running: rows.filter((r) => r.isLive || IN_PROGRESS.has(r.status)).length,
      problems: rows.filter((r) => PROBLEM.has(r.status)).length,
      removed: rows.filter((r) => GONE.has(r.status) || r.status === "SKIPPED").length,
    }),
    [rows],
  );

  const visible = rows.filter((r) => {
    if (filter === "running") return r.isLive || IN_PROGRESS.has(r.status);
    if (filter === "problems") return PROBLEM.has(r.status);
    if (filter === "removed") return GONE.has(r.status) || r.status === "SKIPPED";
    return true;
  });

  const selectable = (r: DeploymentRowView) => !GONE.has(r.status);
  const visibleSelectable = visible.filter(selectable);
  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every((r) => selected.has(r.id));
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const problemIds = rows.filter((r) => PROBLEM.has(r.status) && !r.isLive).map((r) => r.id);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const open = (kind: PlanKind, targetIds: string[]) => setPending({ accountKey, kind, projectId, serviceId, environmentId, targetIds });

  const lockReason = readOnly ? "Read-only mode is on" : protectedProject ? "This project is protected (PROTECTED_PROJECTS)" : undefined;
  const removeLock = lockReason;
  const anyRestartable = selectedRows.some((r) => r.status === "SUCCESS" || r.status === "SLEEPING" || r.status === "CRASHED");
  const anyInProgress = selectedRows.some((r) => IN_PROGRESS.has(r.status));

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "running", label: "Live & in progress" },
    { key: "problems", label: "Failed & crashed" },
    { key: "removed", label: "Removed" },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
        <div role="group" aria-label="Filter deployments" className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-md border px-2 py-1 text-xs ${filter === f.key ? "border-line-strong bg-surface-2 font-medium text-ink" : "border-line text-ink-2 hover:text-ink"}`}
            >
              {f.label} <span className="tabular">({counts[f.key]})</span>
            </button>
          ))}
        </div>
        {problemIds.length > 0 && (
          <button type="button" className={buttonClass("ghost")} onClick={() => setSelected(new Set(problemIds))}>
            Select failed &amp; crashed ({problemIds.length})
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-y border-line bg-surface-2 px-4 py-2 text-sm" aria-live="polite">
          <span className="font-medium">{selected.size} selected</span>
          <button type="button" className={buttonClass("ghost")} onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <span className="flex-1" />
          <button type="button" className={buttonClass("neutral")} disabled={!!lockReason || !anyInProgress} title={lockReason} onClick={() => open("deployment.cancel", [...selected])}>
            Cancel build
          </button>
          <button type="button" className={buttonClass("neutral")} disabled={!!lockReason || !anyRestartable} title={lockReason} onClick={() => open("deployment.restart", [...selected])}>
            <Icon name="rotate" size={12} /> Restart
          </button>
          <button type="button" className={buttonClass("danger")} disabled={!!removeLock} title={removeLock} onClick={() => open("deployment.remove", [...selected])}>
            <Icon name="trash" size={12} /> Remove {selected.size}
          </button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-y border-line text-left text-xs text-ink-2">
              <th scope="col" className="w-10 px-4 py-2">
                <input
                  type="checkbox"
                  aria-label="Select all shown deployments that can be changed"
                  checked={allVisibleSelected}
                  disabled={visibleSelectable.length === 0}
                  onChange={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (allVisibleSelected) visibleSelectable.forEach((r) => next.delete(r.id));
                      else visibleSelectable.forEach((r) => next.add(r.id));
                      return next;
                    })
                  }
                />
              </th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
              <th scope="col" className="px-2 py-2 font-medium">Deployment</th>
              <th scope="col" className="px-2 py-2 font-medium">Created</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-2">
                  No deployments match this filter.
                </td>
              </tr>
            )}
            {visible.map((row) => {
              const s = statusStyle(row.status);
              const canSelect = selectable(row);
              return (
                <tr key={row.id} className={`border-b border-line last:border-b-0 ${selected.has(row.id) ? "bg-[var(--info-wash)]" : "hover:bg-surface-2"}`}>
                  <td className="px-4 py-2 align-top">
                    <input
                      type="checkbox"
                      aria-label={`Select deployment ${row.shortId}`}
                      checked={selected.has(row.id)}
                      disabled={!canSelect}
                      title={canSelect ? undefined : "Already removed — nothing to clean up"}
                      onChange={() => toggle(row.id)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 align-top">
                    <span className="inline-flex items-center gap-1 text-xs font-medium">
                      <Icon name={s.icon} size={12} color={s.color} />
                      {s.label}
                    </span>
                    {row.isLive && (
                      <span className="ml-1.5 rounded border border-line bg-[var(--info-wash)] px-1 py-px text-[11px] font-semibold">LIVE</span>
                    )}
                  </td>
                  <td className="max-w-0 px-2 py-2 align-top">
                    <div className="truncate">{row.message ?? row.image ?? (row.reason ? `${row.reason} deployment` : "Deployment")}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-2">
                      <span className="font-mono">{row.shortId}</span>
                      {row.branch && (
                        <span className="inline-flex items-center gap-1">
                          <Icon name="branch" size={11} /> {row.branch}
                        </span>
                      )}
                      {row.commit && <span className="font-mono">{row.commit}</span>}
                      {row.author && <span>by {row.author}</span>}
                      {row.reason && row.reason !== "deploy" && <span>({row.reason})</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 align-top text-xs text-ink-2" title={row.createdLabel}>
                    {row.createdRelative}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right align-top">
                    <div className="inline-flex gap-1">
                      <button type="button" className={buttonClass("ghost")} onClick={() => setLogsFor(row)}>
                        Logs
                      </button>
                      {row.canRollback && !row.isLive && (
                        <button type="button" className={buttonClass("ghost")} disabled={!!lockReason} title={lockReason} onClick={() => open("deployment.rollback", [row.id])}>
                          Roll back
                        </button>
                      )}
                      {row.canRedeploy && !IN_PROGRESS.has(row.status) && (
                        <button type="button" className={buttonClass("ghost")} disabled={!!lockReason} title={lockReason} onClick={() => open("deployment.redeploy", [row.id])}>
                          Redeploy
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {logsFor && (
        <div className="px-4 pb-4">
          <LogsPanel
            key={logsFor.id}
            accountKey={accountKey}
            deploymentId={logsFor.id}
            title={`${logsFor.shortId} · ${logsFor.message ?? logsFor.image ?? "deployment"}`}
            onClose={() => setLogsFor(null)}
          />
        </div>
      )}

      {pending && (
        <ReviewDialog
          request={pending}
          onClose={() => {
            setPending(null);
            setSelected(new Set());
          }}
        />
      )}
    </div>
  );
}
