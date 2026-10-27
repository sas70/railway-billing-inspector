"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { createDescribePlanAction, executeDescribePlanAction } from "@/app/actions";
import type { DescribeExecutionView, DescribePlanItem, DescribePlanView, DescribeScope } from "@/lib/describe-types";
import { plural } from "@/lib/format";
import { Callout, FLAG_STYLE, Results } from "./ActionReview";
import { buttonClass, type ButtonTone } from "./button";
import { Icon } from "./Icon";

/**
 * Copy saved Claude summaries into Railway project descriptions. Same flow as every other change:
 * the server re-reads Railway and shows current vs new text (nothing changes), you confirm once,
 * and each project is re-checked right before it's written and logged in the audit log.
 */

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "review"; plan: DescribePlanView; error?: string }
  | { name: "running"; plan: DescribePlanView }
  | { name: "done"; plan: DescribePlanView; result: DescribeExecutionView };

export function DescribeButton({
  scope,
  readOnly,
  lockedReason,
  label,
  tone = "neutral",
}: {
  /** One project; omit for every project. */
  scope?: DescribeScope;
  readOnly: boolean;
  lockedReason?: string;
  label: string;
  tone?: ButtonTone;
}) {
  const [open, setOpen] = useState(false);
  const lock = lockedReason ?? (readOnly ? "Read-only — enable Write mode in the header" : undefined);
  return (
    <>
      <button
        type="button"
        className={buttonClass(tone)}
        disabled={!!lock}
        title={lock ?? "Shows each project's current and new Railway description before anything changes"}
        onClick={() => setOpen(true)}
      >
        <Icon name="pencil" size={12} /> {label}
      </button>
      {open && <DescribeDialog scope={scope} onClose={() => setOpen(false)} />}
    </>
  );
}

function DescribeDialog({ scope, onClose }: { scope?: DescribeScope; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [attempt, setAttempt] = useState(0);
  const didChange = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ name: "loading" });
    createDescribePlanAction(scope ?? null).then(
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
    // The scope is fixed for the lifetime of this dialog; `attempt` re-runs the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const running = phase.name === "running";
  const plan = phase.name === "review" || phase.name === "running" || phase.name === "done" ? phase.plan : null;
  const canApprove = phase.name === "review" && !!plan && !plan.blockedReason && plan.runnableCount > 0;

  function handleClosed() {
    onClose();
    // Refresh the page underneath only once the results have been read.
    if (didChange.current) router.refresh();
  }

  async function approve(next: DescribePlanView) {
    setPhase({ name: "running", plan: next });
    try {
      const res = await executeDescribePlanAction(next.id);
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
            {plan?.title ?? (phase.name === "error" ? "Couldn't prepare this review" : "Reading descriptions from Railway…")}
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phase.name === "loading" && (
            <p className="flex items-center gap-2 text-ink-2">
              <Icon name="loader" size={16} className="animate-spin" /> Reading each project and its saved summary. Nothing is changed at this step.
            </p>
          )}

          {phase.name === "error" && <Callout tone="danger" title="Nothing was changed.">{phase.message}</Callout>}

          {plan && phase.name !== "done" && (
            <>
              {plan.demo && <Callout tone="info">Demo mode: this only changes the built-in fake data.</Callout>}
              {plan.blockedReason && <Callout tone="danger" title="This can't run">{plan.blockedReason}</Callout>}

              <section>
                <h3 className="font-semibold">What will happen</h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-5">
                  {plan.impact.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="mt-2 text-ink-2">
                  <span className="font-medium text-ink">Undo: </span>
                  {plan.recovery}
                </p>
              </section>

              {plan.items.length > 0 && (
                <section>
                  <h3 className="font-semibold">
                    Projects ({plan.runnableCount} of {plan.items.length} will change)
                  </h3>
                  <ul className="mt-1.5 divide-y divide-[var(--border)] rounded-lg border border-line">
                    {plan.items.map((item) => (
                      <DescribeRow key={item.key} item={item} />
                    ))}
                  </ul>
                </section>
              )}

              {phase.name === "review" && phase.error && <Callout tone="danger">{phase.error}</Callout>}
              <p className="text-xs text-ink-2">
                This review is valid for 10 minutes and can be used once. Each project is re-read right before it&apos;s written; any whose
                description changed since this review is skipped.
              </p>
            </>
          )}

          {phase.name === "done" && <Results result={phase.result} />}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {phase.name === "done" ? (
            <button key="close" type="button" className={buttonClass("primary", "md")} onClick={() => dialogRef.current?.close()} autoFocus>
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
                <button type="button" className={buttonClass("primary", "md")} disabled={!canApprove} onClick={() => void approve(plan)}>
                  {running ? (
                    <>
                      <Icon name="loader" size={14} className="animate-spin" /> Working…
                    </>
                  ) : (
                    `Update ${plural(plan.runnableCount, "description")}`
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

function DescribeRow({ item }: { item: DescribePlanItem }) {
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="font-medium break-words">{item.projectName}</div>
          <div className="text-xs break-words text-ink-2">
            {item.workspaceName} · {item.repos.join(", ")}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs">
          {item.willRun ? (
            <div className="inline-flex items-center gap-1 font-medium">
              <Icon name="check" size={12} color="var(--status-good)" /> will change
            </div>
          ) : (
            <div className="max-w-[18rem] text-ink-2">
              <span className="font-medium text-ink">skipped</span> — {item.skipReason}
            </div>
          )}
        </div>
      </div>
      {item.willRun && (
        <dl className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
          <dt className="text-ink-2">New</dt>
          <dd className="break-words">{item.after}</dd>
          <dt className="text-ink-2">Now</dt>
          <dd className="break-words whitespace-pre-line text-ink-2">{item.before.trim() ? item.before : <span className="italic">empty</span>}</dd>
        </dl>
      )}
      {item.flags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {item.flags.map((flag) => (
            <span key={flag.text} className={`inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-xs ${FLAG_STYLE[flag.tone].bg}`}>
              <Icon name={FLAG_STYLE[flag.tone].icon} size={11} color={FLAG_STYLE[flag.tone].color} />
              {flag.text}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
