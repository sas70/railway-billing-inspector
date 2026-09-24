"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { createBulkPlanAction, executeBulkPlanAction } from "@/app/actions";
import type { BulkExecutionView, BulkMode, BulkPlanView, BulkTargetInput } from "@/lib/bulk-types";
import { money, plural } from "@/lib/format";
import type { ServiceCatalogRow } from "@/lib/service-row";
import { buttonClass } from "./button";
import { Icon, type IconName } from "./Icon";

function targetsFrom(rows: ServiceCatalogRow[]): BulkTargetInput[] {
  return rows.map((row) => ({
    accountKey: row.accountKey,
    projectId: row.projectId,
    projectName: row.projectName,
    workspaceName: row.workspaceName,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    environmentId: row.environmentId,
    environmentName: row.environmentName,
    liveDeploymentIds: row.liveDeploymentIds,
    latestId: row.latestId,
  }));
}

export function BulkMasterButtons({ rows, readOnly }: { rows: ServiceCatalogRow[]; readOnly: boolean }) {
  const [flow, setFlow] = useState<{ mode: BulkMode; visible: ServiceCatalogRow[]; candidates: ServiceCatalogRow[] } | null>(null);
  const eligibleOn = rows.filter((r) => !r.online && !r.protected);
  const eligibleOff = rows.filter((r) => r.online && !r.protected && r.liveDeploymentIds.length > 0 && r.health !== "deploying");
  const lock = readOnly ? "Read-only — enable Write mode in the header" : undefined;

  function open(mode: BulkMode) {
    setFlow({
      mode,
      visible: rows,
      candidates: mode === "on" ? eligibleOn : eligibleOff,
    });
  }

  return (
    <>
      <button
        type="button"
        className={buttonClass("primary", "sm")}
        disabled={!!lock || eligibleOn.length === 0}
        title={lock ?? (eligibleOn.length === 0 ? "No offline services in this view" : "Start every offline service in this view")}
        onClick={() => open("on")}
      >
        <Icon name="power" size={12} />
        Turn all projects ON
      </button>
      <button
        type="button"
        className={buttonClass("neutral", "sm")}
        disabled={!!lock || eligibleOff.length === 0}
        title={lock ?? (eligibleOff.length === 0 ? "No online services in this view" : "Take every online service in this view offline")}
        onClick={() => open("off")}
      >
        <Icon name="power" size={12} />
        Turn all projects OFF
      </button>
      {flow && <BulkFlow mode={flow.mode} rows={flow.visible} candidates={flow.candidates} onClose={() => setFlow(null)} />}
    </>
  );
}

function BulkFlow({
  mode,
  rows,
  candidates,
  onClose,
}: {
  mode: BulkMode;
  rows: ServiceCatalogRow[];
  candidates: ServiceCatalogRow[];
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"confirm" | "review">("confirm");
  const targets = targetsFrom(candidates);
  if (stage === "confirm") {
    return <ConfirmDialog mode={mode} rows={rows} candidates={candidates} onCancel={onClose} onContinue={() => setStage("review")} />;
  }
  return <BulkReviewDialog mode={mode} targets={targets} onClose={onClose} />;
}

function ConfirmDialog({
  mode,
  rows,
  candidates,
  onCancel,
  onContinue,
}: {
  mode: BulkMode;
  rows: ServiceCatalogRow[];
  candidates: ServiceCatalogRow[];
  onCancel: () => void;
  onContinue: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continuing = useRef(false);
  const titleId = useId();
  const projects = new Set(candidates.map((r) => r.projectId)).size;
  const skipped = rows.length - candidates.length;
  const dollars = candidates.reduce((sum, r) => sum + (r.expectedCost ?? 0), 0);
  const on = mode === "on";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={() => {
        if (!continuing.current) onCancel();
      }}
      className="m-auto w-[min(560px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="px-5 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-ink-2">Confirm first</div>
        <h2 id={titleId} className="mt-1 text-lg font-semibold">
          {on ? "Turn all projects ON?" : "Turn all projects OFF?"}
        </h2>
        <div className="mt-3 space-y-3 text-sm">
          <p>
            Railway has no single “project power” switch. This will {on ? "redeploy" : "stop"}{" "}
            <strong>{plural(candidates.length, "service")}</strong> across <strong>{plural(projects, "project")}</strong>
            {rows.length !== candidates.length ? ` in the current list (${rows.length} visible)` : ""}.
          </p>
          {skipped > 0 && (
            <p className="text-ink-2">
              {skipped} skipped here: already {on ? "online" : "offline"}, protected, or still deploying.
            </p>
          )}
          <p>
            {on ? "Starting them begins billed compute — about " : "Stopping them stops new billed compute — about "}
            <strong>{money(dollars)}</strong> expected this period for this set.
          </p>
          <p className="text-ink-2">
            Each service is one Railway GraphQL mutation (redeploy or remove). Those API calls are not a line item on
            your invoice. Railway’s hourly request budget still applies (~1,000 reads/writes per token). The invoice
            changes only when services start or stop using CPU, memory, and volumes.
          </p>
          <p className="text-ink-2">Next you’ll review the live list and type a confirmation phrase. Nothing changes on this step.</p>
        </div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" className={buttonClass("neutral", "md")} onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
        <button
          type="button"
          className={buttonClass(on ? "primary" : "danger", "md")}
          disabled={candidates.length === 0}
          onClick={() => {
            continuing.current = true;
            onContinue();
          }}
        >
          Continue to review
        </button>
      </footer>
    </dialog>
  );
}

function BulkReviewDialog({ mode, targets, onClose }: { mode: BulkMode; targets: BulkTargetInput[]; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const [phase, setPhase] = useState<
    | { name: "loading" }
    | { name: "error"; message: string }
    | { name: "review"; plan: BulkPlanView; error?: string }
    | { name: "running"; plan: BulkPlanView }
    | { name: "done"; plan: BulkPlanView; result: BulkExecutionView }
  >({ name: "loading" });
  const [typed, setTyped] = useState("");
  const [attempt, setAttempt] = useState(0);
  const didChange = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ name: "loading" });
    setTyped("");
    createBulkPlanAction({ mode, targets }).then(
      (res) => {
        if (!cancelled) setPhase(res.ok ? { name: "review", plan: res.data } : { name: "error", message: res.error });
      },
      (error: unknown) => {
        if (!cancelled) setPhase({ name: "error", message: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
    // mode/targets are fixed for this dialog; `attempt` re-runs the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const running = phase.name === "running";
  const plan = phase.name === "review" || phase.name === "running" || phase.name === "done" ? phase.plan : null;
  const phraseOk = !plan?.requiresPhrase || typed.trim() === plan.phrase;
  const canApprove = phase.name === "review" && !!plan && !plan.blockedReason && plan.runnableCount > 0 && phraseOk;

  function handleClosed() {
    onClose();
    if (didChange.current) router.refresh();
  }

  async function approve(next: BulkPlanView) {
    setPhase({ name: "running", plan: next });
    try {
      const res = await executeBulkPlanAction(next.id, typed);
      if (res.ok) {
        didChange.current = res.data.succeeded + res.data.failed + res.data.unknown > 0;
        setPhase({ name: "done", plan: next, result: res.data });
      } else {
        setPhase({ name: "review", plan: next, error: res.error });
      }
    } catch (error) {
      setPhase({ name: "review", plan: next, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (running) event.preventDefault();
      }}
      onClose={handleClosed}
      className="m-auto w-[min(760px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-ink shadow-2xl"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="border-b border-line px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-2">
            {phase.name === "done" ? "Result" : "Review before anything changes"}
          </div>
          <h2 id={titleId} className="mt-1 text-lg font-semibold">
            {plan?.title ?? (phase.name === "error" ? "Couldn't prepare this action" : "Checking current state on Railway…")}
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phase.name === "loading" && (
            <p className="flex items-center gap-2 text-ink-2">
              <Icon name="loader" size={16} className="animate-spin" /> Re-reading each service. Nothing is changed at this step.
            </p>
          )}
          {phase.name === "error" && (
            <p className="rounded-lg border border-line bg-[var(--danger-wash)] px-3 py-2">Nothing was changed. {phase.message}</p>
          )}
          {plan && phase.name !== "done" && (
            <>
              {plan.blockedReason && (
                <p className="rounded-lg border border-line bg-[var(--danger-wash)] px-3 py-2">{plan.blockedReason}</p>
              )}
              <ul className="list-disc space-y-1 pl-5">
                {plan.impact.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {plan.recovery && (
                <p className="text-ink-2">
                  <span className="font-medium text-ink">Undo: </span>
                  {plan.recovery}
                </p>
              )}
              <section>
                <h3 className="font-semibold">
                  Items ({plan.runnableCount} of {plan.items.length} will run)
                </h3>
                <ul className="mt-1.5 divide-y divide-[var(--border)] rounded-lg border border-line">
                  {plan.items.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{item.label}</div>
                        {item.detail && <div className="text-xs text-ink-2">{item.detail}</div>}
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        {item.willRun ? (
                          <div className="inline-flex items-center gap-1 font-medium">
                            <Icon name="check" size={12} color="var(--status-good)" /> will run
                          </div>
                        ) : (
                          <div className="max-w-64 text-ink-2">
                            <span className="font-medium text-ink">skipped</span> — {item.skipReason}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              {phase.name === "review" && phase.error && (
                <p className="rounded-lg border border-line bg-[var(--danger-wash)] px-3 py-2">{phase.error}</p>
              )}
              {!plan.blockedReason && plan.runnableCount > 0 && (
                <label className="block">
                  <span className="font-medium">
                    To approve, type <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.95em]">{plan.phrase}</code>
                  </span>
                  <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={running}
                    className="mt-1.5 block w-full rounded-md border border-line-strong bg-page px-3 py-2 font-mono text-sm outline-none focus:border-[var(--series-1)]"
                  />
                </label>
              )}
            </>
          )}
          {phase.name === "done" && <BulkResults result={phase.result} />}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {phase.name === "done" ? (
            <button type="button" className={buttonClass("primary", "md")} onClick={() => dialogRef.current?.close()} autoFocus>
              Close
            </button>
          ) : (
            <>
              {(phase.name === "error" || (phase.name === "review" && phase.error)) && (
                <button type="button" className={buttonClass("ghost", "md")} onClick={() => setAttempt((n) => n + 1)}>
                  <Icon name="refresh" size={13} /> Review again
                </button>
              )}
              <button type="button" className={buttonClass("neutral", "md")} disabled={running} onClick={() => dialogRef.current?.close()}>
                Cancel
              </button>
              {plan && (
                <button
                  type="button"
                  className={buttonClass(plan.mode === "off" ? "danger" : "primary", "md")}
                  disabled={!canApprove}
                  onClick={() => void approve(plan)}
                >
                  {running ? (
                    <>
                      <Icon name="loader" size={14} className="animate-spin" /> Working…
                    </>
                  ) : (
                    `${plan.verb} ${plan.runnableCount}`
                  )}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

function BulkResults({ result }: { result: BulkExecutionView }) {
  const icon: Record<string, { name: IconName; color: string; label: string }> = {
    success: { name: "check", color: "var(--status-good)", label: "Done" },
    failed: { name: "x", color: "var(--status-critical)", label: "Failed" },
    skipped: { name: "circle", color: "var(--ink-muted)", label: "Skipped" },
    unknown: { name: "alert", color: "var(--status-warning)", label: "Unknown" },
  };
  return (
    <div className="space-y-3">
      <p className="font-medium">
        {result.succeeded} done · {result.failed} failed · {result.skipped} skipped
        {result.unknown > 0 && ` · ${result.unknown} unknown`}
      </p>
      <ul className="divide-y divide-[var(--border)] rounded-lg border border-line">
        {result.results.map((r) => (
          <li key={`${r.targetId}-${r.label}`} className="flex gap-2 px-3 py-2">
            <Icon name={icon[r.outcome].name} size={14} color={icon[r.outcome].color} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div>
                <span className="font-medium">{icon[r.outcome].label}:</span> <span className="break-words">{r.label}</span>
              </div>
              {r.message && <div className="text-xs text-ink-2 break-words">{r.message}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
