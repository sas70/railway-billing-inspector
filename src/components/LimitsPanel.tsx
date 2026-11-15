"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { createLimitPlanAction, executeLimitPlanAction } from "@/app/actions";
import { dateNoYear, money, plural } from "@/lib/format";
import {
  agentFromText,
  assessAgent,
  assessCompute,
  computeFromText,
  sameAgent,
  sameCompute,
  suggestHardLimit,
  type ComputeStatus,
} from "@/lib/limit-rules";
import type { LimitExecutionView, LimitPlanItem, LimitPlanView, LimitRequest, LimitRow } from "@/lib/limits-types";
import type { PlanFlag } from "@/lib/plan-types";
import { Callout, FLAG_STYLE, Results } from "./ActionReview";
import { buttonClass } from "./button";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader, PlanBadge } from "./ui";

/**
 * One card per workspace: compute and Railway Agent spend against their limits, and a form to
 * change them. "Review change" opens a dialog that re-reads Railway (nothing changes yet); only
 * its confirm button — or the typed phrase, when the change can stop services — changes Railway.
 */

const STATUS: Record<ComputeStatus, { label: string; tone: "neutral" | "info" | "warning" | "danger"; hint: string }> = {
  "at-limit": { label: "At hard limit", tone: "danger", hint: "Railway stops this workspace's services at the hard limit." },
  "projected-over": { label: "Projected over limit", tone: "danger", hint: "The projected bill passes the hard limit, so services can go offline before the period ends." },
  near: { label: "Past 75% of limit", tone: "warning", hint: "Railway sends its first warning email at 75% of the hard limit." },
  "no-cap": { label: "No hard limit", tone: "neutral", hint: "Railway won't stop services because of cost." },
  ok: { label: "Within limit", tone: "neutral", hint: "Usage and the projected bill are under the hard limit." },
};

const dollarsText = (value: number | null) => (value == null ? "" : String(value));
const centsText = (value: number | null) => (value == null ? "" : (value / 100).toFixed(2).replace(/\.00$/, ""));

export function LimitsPanel({ rows, readOnly }: { rows: LimitRow[]; readOnly: boolean }) {
  return (
    <div className="space-y-5">
      {rows.map((row) => (
        <LimitsCard key={row.key} row={row} readOnly={readOnly} />
      ))}
    </div>
  );
}

function LimitsCard({ row, readOnly }: { row: LimitRow; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const status = row.compute.ok ? STATUS[row.compute.status] : null;

  return (
    <Card id={`ws-${row.workspaceId}`} className="scroll-mt-20">
      <CardHeader
        title={
          <span className="flex flex-wrap items-center gap-2 text-base">
            {row.workspaceName} <PlanBadge plan={row.plan} />
            {status && (
              <Badge tone={status.tone} title={status.hint}>
                {status.label}
              </Badge>
            )}
          </span>
        }
        subtitle={[
          row.accountLabel,
          row.period ? `period ends ${dateNoYear(row.period.end)}${row.daysLeft != null ? ` (${plural(row.daysLeft, "day")} left)` : ""}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          !editing && (
            <button
              type="button"
              className={buttonClass("neutral", "sm")}
              disabled={!!row.lockReason}
              title={row.lockReason}
              onClick={() => setEditing(true)}
            >
              <Icon name="pencil" size={12} /> Change limits
            </button>
          )
        }
      />

      <div className="grid gap-6 p-4 md:grid-cols-2">
        <section aria-label="Compute usage limit">
          <h3 className="text-sm font-semibold">Compute</h3>
          {row.compute.ok ? (
            <ComputeSummary compute={row.compute} />
          ) : (
            <p className="mt-1 text-sm text-ink-2">Couldn&apos;t read billing: {row.compute.error}</p>
          )}
        </section>
        <section aria-label="Railway Agent usage limit">
          <h3 className="text-sm font-semibold">Railway Agent</h3>
          {row.agent.ok ? <AgentSummary agent={row.agent} plan={row.plan} /> : <p className="mt-1 text-sm text-ink-2">Couldn&apos;t read it: {row.agent.error}</p>}
        </section>
      </div>

      {row.lockReason && <p className="border-t border-line px-4 py-3 text-xs text-ink-2">{row.lockReason}</p>}
      {editing && <LimitsForm row={row} readOnly={readOnly} onDone={() => setEditing(false)} />}
    </Card>
  );
}

function ComputeSummary({ compute }: { compute: Extract<LimitRow["compute"], { ok: true }> }) {
  const { limit, usage, projected, status } = compute;
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="tabular">
        <span className="text-2xl font-semibold tracking-tight">{money(usage)}</span>
        <span className="text-ink-2"> {limit.hard != null ? `of ${money(limit.hard, { whole: true })} hard limit` : "used, no hard limit"}</span>
      </div>
      {limit.hard != null && limit.hard > 0 && <LimitMeter value={usage} projected={projected} max={limit.hard} status={status} label="Compute usage against the hard limit" />}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-2">
        <dt>Projected</dt>
        <dd className="tabular text-ink">{projected != null ? `${money(projected)} by period end` : "unavailable"}</dd>
        <dt>Email alert</dt>
        <dd className="tabular text-ink">{limit.alert != null ? money(limit.alert, { whole: true }) : "none"}</dd>
      </dl>
    </div>
  );
}

function AgentSummary({ agent, plan }: { agent: Extract<LimitRow["agent"], { ok: true }>; plan: string }) {
  const { limit, usedCents, custom } = agent;
  const hard = limit.hardCents;
  return (
    <div className="mt-2 space-y-2 text-sm">
      <div className="tabular">
        <span className="text-2xl font-semibold tracking-tight">{money(usedCents / 100)}</span>
        <span className="text-ink-2"> {hard == null ? "used, no hard limit" : hard === 0 ? "used · agent blocked ($0 limit)" : `of ${money(hard / 100)} hard limit`}</span>
      </div>
      {hard != null && hard > 0 && (
        <LimitMeter value={usedCents / 100} projected={null} max={hard / 100} status={usedCents >= hard ? "at-limit" : usedCents >= hard * 0.75 ? "near" : "ok"} label="Agent usage against its hard limit" />
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-ink-2">
        <dt>Email alert</dt>
        <dd className="tabular text-ink">{limit.alertCents != null ? money(limit.alertCents / 100) : "none"}</dd>
        <dt>Limit</dt>
        <dd className="text-ink">
          {custom === false ? `Railway's default for ${plan === "PRO" ? "Pro" : "Hobby"}` : "Set by you"}; pauses only the agent
        </dd>
      </dl>
    </div>
  );
}

/** Spend against a limit, with a tick where the projected bill lands. */
function LimitMeter({ value, projected, max, status, label }: { value: number; projected: number | null; max: number; status: ComputeStatus; label: string }) {
  const fill = status === "at-limit" || status === "projected-over" ? "var(--status-critical)" : status === "near" ? "var(--status-warning)" : "var(--meter-fill)";
  const at = (n: number) => `${Math.min(100, Math.max(0, (n / max) * 100))}%`;
  return (
    <div className="relative pt-1">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(2))}
        aria-valuetext={`${money(value)} of ${money(max)}${projected != null ? `, projected ${money(projected)}` : ""}`}
        className="h-2.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--meter-track)" }}
      >
        <div className="h-full rounded-full" style={{ width: at(value), background: fill }} />
      </div>
      {projected != null && projected > value && (
        <span
          aria-hidden="true"
          title={`Projected ${money(projected)}`}
          className="absolute top-0 h-4 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: at(projected) }}
        />
      )}
    </div>
  );
}

// ── Edit form ───────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-md border border-line-strong bg-page focus-within:border-[var(--series-1)]">
        <span className="pl-3 text-ink-2" aria-hidden="true">
          $
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-hint`}
          className="w-full bg-transparent px-2 py-2 text-sm tabular outline-none disabled:opacity-50"
        />
      </div>
      <p id={`${id}-hint`} className="mt-1 text-xs text-ink-2">
        {hint}
      </p>
    </div>
  );
}

function LimitsForm({ row, readOnly, onDone }: { row: LimitRow; readOnly: boolean; onDone: () => void }) {
  const compute = row.compute.ok ? row.compute : null;
  const agent = row.agent.ok ? row.agent : null;
  const [computeAlert, setComputeAlert] = useState(dollarsText(compute?.limit.alert ?? null));
  const [computeHard, setComputeHard] = useState(dollarsText(compute?.limit.hard ?? null));
  const [agentAlert, setAgentAlert] = useState(centsText(agent?.limit.alertCents ?? null));
  const [agentHard, setAgentHard] = useState(centsText(agent?.limit.hardCents ?? null));
  const [request, setRequest] = useState<LimitRequest | null>(null);

  const exposure = useMemo(() => (compute ? { usage: compute.usage, projected: compute.projected } : null), [compute]);
  const suggestion = exposure ? suggestHardLimit(exposure) : null;

  const draft = useMemo(() => {
    const errors: string[] = [];
    const flags: PlanFlag[] = [];
    let phrase: string | null = null;
    const next: LimitRequest = { accountKey: row.accountKey, workspaceId: row.workspaceId };
    if (compute && exposure) {
      const parsed = computeFromText(computeAlert, computeHard);
      if (!parsed.ok) errors.push(parsed.error);
      else if (!sameCompute(compute.limit, parsed.value)) {
        next.compute = parsed.value;
        const assessment = assessCompute(compute.limit, parsed.value, exposure);
        flags.push(...assessment.flags);
        phrase = assessment.phrase;
      }
    }
    if (agent) {
      const parsed = agentFromText(agentAlert, agentHard);
      const unchanged = agentAlert === centsText(agent.limit.alertCents) && agentHard === centsText(agent.limit.hardCents);
      if (!parsed.ok) {
        if (!unchanged) errors.push(parsed.error);
      } else if (!sameAgent(agent.limit, parsed.value)) {
        next.agent = parsed.value;
        flags.push(...assessAgent(agent.limit, parsed.value, agent.usedCents));
      }
    }
    return { errors, flags, phrase, next, changed: !!(next.compute || next.agent) };
  }, [row.accountKey, row.workspaceId, compute, agent, exposure, computeAlert, computeHard, agentAlert, agentHard]);

  const blocked = readOnly
    ? "Read-only: enable Write mode in the header to change limits."
    : draft.errors.length > 0
      ? draft.errors[0]
      : !draft.changed
        ? "Change a value to review it."
        : null;

  return (
    <>
    <form
      className="space-y-4 border-t border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!blocked) setRequest(draft.next);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {compute && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Compute (whole dollars)</legend>
            <Field label="Email alert" hint="$5 or more. Blank: no alert." value={computeAlert} onChange={setComputeAlert} placeholder="none" />
            <Field
              label="Hard limit"
              hint="$10 or more. At this amount Railway takes every service in the workspace offline. Blank: no hard limit."
              value={computeHard}
              onChange={setComputeHard}
              placeholder="none"
            />
            {suggestion != null && computeHard !== String(suggestion) && (
              <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setComputeHard(String(suggestion))}>
                Use {money(suggestion, { whole: true })} (projected bill + 25%)
              </button>
            )}
          </fieldset>
        )}
        {agent && (
          <fieldset className="space-y-3">
            <legend className="text-sm font-semibold">Railway Agent (dollars and cents)</legend>
            <Field label="Email alert" hint="Blank: no alert." value={agentAlert} onChange={setAgentAlert} placeholder="none" />
            <Field label="Hard limit" hint="Required: Railway can't remove it. 0 blocks the agent. Services keep running either way." value={agentHard} onChange={setAgentHard} />
          </fieldset>
        )}
      </div>

      {draft.changed && draft.errors.length === 0 && (draft.flags.length > 0 || draft.phrase) && (
        <ul className="space-y-1 text-sm" aria-label="What the review will flag">
          {draft.flags.map((flag) => (
            <li key={flag.text} className={`flex items-start gap-1.5 rounded-md border border-line px-2 py-1 ${FLAG_STYLE[flag.tone].bg}`}>
              <Icon name={FLAG_STYLE[flag.tone].icon} size={13} color={FLAG_STYLE[flag.tone].color} className="mt-0.5 shrink-0" />
              {flag.text}
            </li>
          ))}
          {draft.phrase && (
            <li className="text-xs text-ink-2">
              The review will ask you to type <code className="font-mono">{draft.phrase}</code> to approve.
            </li>
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={buttonClass("primary", "md")} disabled={!!blocked}>
          Review change
        </button>
        <button type="button" className={buttonClass("neutral", "md")} onClick={onDone}>
          Cancel
        </button>
        {blocked && <span className="text-xs text-ink-2">{blocked}</span>}
      </div>
    </form>
    {/* Outside the form, so Enter in the dialog's phrase box can't submit the form behind it. */}
    {request && (
      <LimitsDialog
        request={request}
        onClose={(ran) => {
          setRequest(null);
          if (ran) onDone();
        }}
      />
    )}
    </>
  );
}

// ── Review dialog ───────────────────────────────────────────────────────────

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "review"; plan: LimitPlanView; error?: string }
  | { name: "running"; plan: LimitPlanView }
  | { name: "done"; plan: LimitPlanView; result: LimitExecutionView };

function LimitsDialog({ request, onClose }: { request: LimitRequest; onClose: (ran: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [typed, setTyped] = useState("");
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ name: "loading" });
    setTyped("");
    createLimitPlanAction(request).then(
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
  const plan = phase.name === "review" || phase.name === "running" || phase.name === "done" ? phase.plan : null;
  const phraseOk = !plan?.requiresPhrase || typed.trim().replace(/\s+/g, " ") === plan.phrase;
  const canApprove = phase.name === "review" && !!plan && !plan.blockedReason && plan.runnableCount > 0 && phraseOk;

  function handleClosed() {
    onClose(ran.current);
    // Refresh the cards underneath once the results have been read.
    if (ran.current) router.refresh();
  }

  async function approve(next: LimitPlanView) {
    setPhase({ name: "running", plan: next });
    try {
      const res = await executeLimitPlanAction(next.id, typed);
      if (res.ok) {
        ran.current = true;
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
      className="m-auto w-[min(720px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-0 text-left font-normal text-ink shadow-2xl"
    >
      <div className="flex max-h-[85vh] flex-col">
        <header className="border-b border-line px-5 py-4">
          <div className="text-xs font-medium uppercase tracking-wide text-ink-2">{phase.name === "done" ? "Result" : "Review before anything changes"}</div>
          <h2 id={titleId} className="mt-1 text-lg font-semibold break-words">
            {plan?.title ?? (phase.name === "error" ? "Couldn't prepare this review" : "Reading usage and limits from Railway…")}
          </h2>
          {plan && <p className="mt-1 text-sm text-ink-2">{[plan.account, plan.workspace].join(" › ")}</p>}
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phase.name === "loading" && (
            <p className="flex items-center gap-2 text-ink-2">
              <Icon name="loader" size={16} className="animate-spin" /> Re-reading usage, the projected bill and the current limits. Nothing is changed at
              this step.
            </p>
          )}

          {phase.name === "error" && (
            <Callout tone="danger" title="Nothing was changed.">
              {phase.message}
            </Callout>
          )}

          {plan && phase.name !== "done" && (
            <>
              {plan.demo && <Callout tone="info">Demo mode: this only changes the built-in fake data.</Callout>}
              {plan.blockedReason && (
                <Callout tone="danger" title="This can't run">
                  {plan.blockedReason}
                </Callout>
              )}

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

              <section>
                <h3 className="font-semibold">
                  Limits ({plan.runnableCount} of {plan.items.length} will change)
                </h3>
                <ul className="mt-1.5 divide-y divide-[var(--border)] rounded-lg border border-line">
                  {plan.items.map((item) => (
                    <PlanRow key={item.key} item={item} />
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
                    autoCapitalize="characters"
                    disabled={running}
                    className="mt-1.5 block w-full rounded-md border border-line-strong bg-page px-3 py-2 font-mono text-sm outline-none focus:border-[var(--series-1)]"
                  />
                </label>
              )}
              <p className="text-xs text-ink-2">
                This review is valid for 10 minutes and can be used once. The limits and usage are re-read right before anything is sent; if
                either changed in a way that matters, that limit is skipped.
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
                <button
                  type="button"
                  className={buttonClass(plan.requiresPhrase ? "danger" : "primary", "md")}
                  disabled={!canApprove}
                  onClick={() => void approve(plan)}
                >
                  {running ? (
                    <>
                      <Icon name="loader" size={14} className="animate-spin" /> Saving…
                    </>
                  ) : (
                    `Set ${plural(plan.runnableCount, "limit")}`
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

function PlanRow({ item }: { item: LimitPlanItem }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="font-medium">{item.label}</div>
        <div className="text-xs text-ink-2">
          {item.before} <span aria-hidden="true">→</span>
          <span className="sr-only">changes to</span> <span className="text-ink">{item.after}</span>
        </div>
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
        {item.willRun ? (
          <div className="inline-flex items-center gap-1 font-medium">
            <Icon name="check" size={12} color="var(--status-good)" /> will change
          </div>
        ) : (
          <div className="max-w-[16rem] text-ink-2">
            <span className="font-medium text-ink">skipped</span> — {item.skipReason}
          </div>
        )}
      </div>
    </li>
  );
}
