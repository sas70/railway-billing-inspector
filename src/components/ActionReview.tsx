"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { createPlanAction, executePlanAction } from "@/app/actions";
import type { ExecutionView, PlanFlag, PlanRequest, PlanView } from "@/lib/plan-types";
import { buttonClass, type ButtonTone } from "./button";
import { Icon, type IconName } from "./Icon";

/**
 * Every change goes through this dialog:
 *   1. the server re-reads Railway and returns a plan (nothing changes yet),
 *   2. you read what will happen and, for destructive actions, type the phrase,
 *   3. only then does the server execute exactly that plan and log it.
 */

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "review"; plan: PlanView; error?: string }
  | { name: "running"; plan: PlanView }
  | { name: "done"; plan: PlanView; result: ExecutionView };

const FLAG_STYLE: Record<PlanFlag["tone"], { icon: IconName; color: string; bg: string }> = {
  danger: { icon: "alert", color: "var(--status-critical)", bg: "bg-[var(--danger-wash)]" },
  warning: { icon: "alert", color: "var(--status-warning)", bg: "bg-[var(--warning-wash)]" },
  info: { icon: "info", color: "var(--series-1)", bg: "bg-[var(--info-wash)]" },
};

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function ReviewDialog({ request, onClose }: { request: PlanRequest; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
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
    createPlanAction(request).then(
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
    // The request is fixed for the lifetime of this dialog; `attempt` re-runs the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const running = phase.name === "running";

  function handleClosed() {
    onClose();
    // Refresh the page underneath only once the results have been read.
    if (didChange.current) router.refresh();
  }

  async function approve(plan: PlanView) {
    setPhase({ name: "running", plan });
    try {
      const res = await executePlanAction(plan.id, typed);
      if (res.ok) {
        didChange.current = res.data.succeeded + res.data.failed + res.data.unknown > 0;
        setPhase({ name: "done", plan, result: res.data });
      } else {
        setPhase({ name: "review", plan, error: res.error });
      }
    } catch (error) {
      setPhase({ name: "review", plan, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const plan = phase.name === "review" || phase.name === "running" || phase.name === "done" ? phase.plan : null;
  const phraseOk = !plan?.requiresPhrase || typed.trim() === plan.phrase;
  const canApprove = phase.name === "review" && !!plan && !plan.blockedReason && plan.runnableCount > 0 && phraseOk;

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
          {plan && (
            <p className="mt-1 text-sm text-ink-2">
              {[plan.context.account, plan.context.workspace, plan.context.project, plan.context.environment, plan.context.service]
                .filter(Boolean)
                .join(" › ")}
            </p>
          )}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phase.name === "loading" && (
            <p className="flex items-center gap-2 text-ink-2">
              <Icon name="loader" size={16} className="animate-spin" /> Reading the latest state from Railway. Nothing is changed at this step.
            </p>
          )}

          {phase.name === "error" && <Callout tone="danger" title="Nothing was changed.">{phase.message}</Callout>}

          {plan && phase.name !== "done" && (
            <>
              {plan.demo && <Callout tone="info">Demo mode: this only changes the built-in fake data.</Callout>}
              {plan.blockedReason && <Callout tone="danger" title="This can't run">{plan.blockedReason}</Callout>}

              <section>
                <h3 className="font-semibold">What will happen</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink">
                  {plan.impact.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {plan.recovery && (
                  <p className="mt-2 text-ink-2">
                    <span className="font-medium text-ink">Undo: </span>
                    {plan.recovery}
                  </p>
                )}
              </section>

              <section>
                <h3 className="font-semibold">
                  Items ({plan.runnableCount} of {plan.items.length} will run)
                </h3>
                <ul className="mt-1.5 divide-y divide-[var(--border)] rounded-lg border border-line">
                  {plan.items.map((item) => (
                    <li key={item.targetId} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-medium break-words">{item.label}</div>
                        {item.detail && <div className="text-xs text-ink-2">{item.detail}</div>}
                        {item.flags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.flags.map((flag) => (
                              <span key={flag.text} className={`inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs ${FLAG_STYLE[flag.tone].bg}`}>
                                <Icon name={FLAG_STYLE[flag.tone].icon} size={11} color={FLAG_STYLE[flag.tone].color} />
                                {flag.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        {item.status && <div className="text-ink-2">status: {item.status.toLowerCase()}</div>}
                        {item.willRun ? (
                          <div className="mt-0.5 inline-flex items-center gap-1 font-medium">
                            <Icon name="check" size={12} color="var(--status-good)" /> will run
                          </div>
                        ) : (
                          <div className="mt-0.5 max-w-[16rem] text-ink-2">
                            <span className="font-medium text-ink">skipped</span> — {item.skipReason}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {phase.name === "review" && phase.error && <Callout tone="danger">{phase.error}</Callout>}

              {!plan.blockedReason && plan.runnableCount > 0 && plan.requiresPhrase && (
                <label className="block">
                  <span className="font-medium">
                    To approve, type <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.95em]">{plan.phrase}</code>
                  </span>
                  <input
                    autoFocus
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canApprove) void approve(plan);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    disabled={running}
                    className="mt-1.5 block w-full rounded-md border border-line-strong bg-page px-3 py-2 font-mono text-sm outline-none focus:border-[var(--series-1)]"
                    aria-describedby={`${titleId}-expiry`}
                  />
                </label>
              )}
              <p id={`${titleId}-expiry`} className="text-xs text-ink-2">
                This review is valid until {timeOf(plan.expiresAt)} and can be used once. Each item is re-checked on Railway right before it runs;
                anything that changed since this review is skipped.
              </p>
            </>
          )}

          {phase.name === "done" && <Results result={phase.result} />}
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
                  className={buttonClass(plan.destructive ? "danger" : "primary", "md")}
                  disabled={!canApprove}
                  onClick={() => void approve(plan)}
                >
                  {running ? (
                    <>
                      <Icon name="loader" size={14} className="animate-spin" /> Working…
                    </>
                  ) : (
                    `${plan.verb}${plan.runnableCount > 1 ? ` ${plan.runnableCount}` : ""}`
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

function Results({ result }: { result: ExecutionView }) {
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
          <li key={r.targetId} className="flex gap-2 px-3 py-2">
            <Icon name={icon[r.outcome].name} size={14} color={icon[r.outcome].color} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div>
                <span className="font-medium">{icon[r.outcome].label}:</span> <span className="break-words">{r.label}</span>
              </div>
              {r.message && <div className="text-xs text-ink-2 break-words">{r.message}</div>}
              {r.traceIds && <div className="text-xs text-ink-2">Railway trace ID: {r.traceIds.join(", ")}</div>}
            </div>
          </li>
        ))}
      </ul>
      {result.auditWritten ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-2">
          <Icon name="check" size={12} color="var(--status-good)" /> Recorded in the audit log.
        </p>
      ) : (
        <Callout tone="warning">{result.auditError}</Callout>
      )}
      {result.failed + result.unknown > 0 && (
        <p className="text-xs text-ink-2">
          Nothing is retried automatically. Refresh the page, check the current state on Railway, and review again if needed.
        </p>
      )}
    </div>
  );
}

function Callout({ tone, title, children }: { tone: "danger" | "warning" | "info"; title?: string; children: React.ReactNode }) {
  const s = FLAG_STYLE[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={`flex gap-2 rounded-lg border border-line px-3 py-2 ${s.bg}`}>
      <Icon name={s.icon} size={15} color={s.color} className="mt-0.5 shrink-0" />
      <div>
        {title && <div className="font-medium">{title}</div>}
        <div className={title ? "text-ink-2" : undefined}>{children}</div>
      </div>
    </div>
  );
}

/** A button that opens the review dialog for one action. */
export function ActionButton({
  request,
  label,
  tone = "neutral",
  icon,
  disabled,
  disabledReason,
  size = "sm",
}: {
  request: PlanRequest;
  label: string;
  tone?: ButtonTone;
  icon?: IconName;
  disabled?: boolean;
  disabledReason?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={buttonClass(tone, size)}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
      >
        {icon && <Icon name={icon} size={size === "sm" ? 12 : 14} />}
        {label}
      </button>
      {open && <ReviewDialog request={request} onClose={() => setOpen(false)} />}
    </>
  );
}
