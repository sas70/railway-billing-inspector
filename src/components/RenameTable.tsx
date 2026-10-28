"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { createRenamePlanAction, executeRenamePlanAction } from "@/app/actions";
import { plural } from "@/lib/format";
import { cleanProjectName, MAX_RENAMES, NAME_MAX } from "@/lib/name-suggest";
import type { RenameExecutionView, RenamePlanItem, RenamePlanView, RenameRequestItem, RenameRow } from "@/lib/rename-types";
import { Callout, FLAG_STYLE, Results } from "./ActionReview";
import { buttonClass } from "./button";
import { Icon } from "./Icon";
import { Badge, Card, CardHeader, EmptyState } from "./ui";

/**
 * The bulk rename table: every project, with Railway's random names ticked and a suggested slug
 * filled in. Nothing changes on this page. "Review" asks the server for a plan (a fresh read of
 * each project, with skip reasons), and only the confirm button in that dialog renames anything.
 */

/** What the person has ticked and typed for one row. `base` is Railway's name when the draft was made. */
type Draft = { checked: boolean; value: string; base: string };
type Check = { state: "off" } | { state: "problem"; message: string } | { state: "ready"; name: string };

const SOURCE_LABEL = { ai: "its code summary", repo: "its repo name" } as const;

/** A new row starts ticked, with its suggestion filled in, when its name looks like one of Railway's random ones. */
function freshDraft(row: RenameRow): Draft {
  const prefill = row.generated && row.suggestion && !row.lockReason ? row.suggestion.name : "";
  return { checked: prefill !== "", value: prefill, base: row.name };
}

/**
 * The row's draft. Drafts survive the refresh after a review, so names typed for projects that were
 * skipped or not ticked stay put; a project whose name changed (renamed here or in Railway) starts over.
 */
function draftFor(drafts: Record<string, Draft>, row: RenameRow): Draft {
  const draft = drafts[row.key];
  return draft && draft.base === row.name ? draft : freshDraft(row);
}

function checkDraft(row: RenameRow, draft: Draft): Check {
  if (!draft.checked || row.lockReason) return { state: "off" };
  if (!draft.value.trim()) return { state: "problem", message: "Type a new name, or untick it." };
  const name = cleanProjectName(draft.value);
  if (!name) return { state: "problem", message: `Use 1–${NAME_MAX} characters, without control characters.` };
  if (name === row.name) return { state: "problem", message: "That's its current name. Change it, or untick it." };
  return { state: "ready", name };
}

export function RenameTable({ rows, readOnly }: { rows: RenameRow[]; readOnly: boolean }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [review, setReview] = useState<RenameRequestItem[] | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const statusRef = useRef<HTMLParagraphElement>(null);

  const checks = useMemo(() => new Map(rows.map((row) => [row.key, checkDraft(row, draftFor(drafts, row))])), [rows, drafts]);
  const ready = rows.flatMap((row) => {
    const check = checks.get(row.key);
    return check?.state === "ready" ? [{ row, name: check.name }] : [];
  });
  const problems = rows.filter((row) => checks.get(row.key)?.state === "problem").length;

  // New names another project in the same workspace has (or is also getting). Allowed, but flagged.
  const clashes = useMemo(() => {
    const finalName = (row: RenameRow) => {
      const check = checks.get(row.key);
      return `${row.workspaceId}|${(check?.state === "ready" ? check.name : row.name).toLowerCase()}`;
    };
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(finalName(row), (counts.get(finalName(row)) ?? 0) + 1);
    return new Set(rows.filter((row) => checks.get(row.key)?.state === "ready" && (counts.get(finalName(row)) ?? 0) > 1).map((row) => row.key));
  }, [rows, checks]);

  const randomRows = rows.filter((row) => row.generated && !row.lockReason);
  const prefilled = randomRows.filter((row) => row.suggestion).length;

  function update(row: RenameRow, next: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [row.key]: { ...draftFor(current, row), ...next } }));
  }

  const focusInput = (row: RenameRow) => requestAnimationFrame(() => inputs.current.get(row.key)?.focus());

  function toggle(row: RenameRow, checked: boolean) {
    const draft = draftFor(drafts, row);
    if (checked && !draft.value.trim()) {
      if (row.suggestion) {
        update(row, { checked, value: row.suggestion.name });
      } else {
        update(row, { checked });
        focusInput(row);
      }
      return;
    }
    update(row, { checked });
  }

  function edit(row: RenameRow, value: string) {
    // Typing a different name ticks the row; clearing it (or typing the current name) unticks it.
    update(row, { value, checked: value.trim() !== "" && cleanProjectName(value) !== row.name });
  }

  function applySuggestion(row: RenameRow) {
    if (!row.suggestion) return;
    edit(row, row.suggestion.name);
    // The "Use" button turns into plain text once applied, so keep focus in the row.
    focusInput(row);
  }

  function tickRandom() {
    setDrafts((current) => {
      const next = { ...current };
      for (const row of randomRows) {
        const draft = draftFor(current, row);
        const value = draft.value.trim() ? draft.value : (row.suggestion?.name ?? "");
        if (value) next[row.key] = { ...draft, checked: true, value };
      }
      return next;
    });
  }

  function untickAll() {
    setDrafts((current) => Object.fromEntries(rows.map((row) => [row.key, { ...draftFor(current, row), checked: false }])));
  }

  function closeReview(ran: boolean) {
    setReview(null);
    // After a run the table refreshes and the Review button may turn disabled, so put focus on the
    // status line (it says how many renames are ready) rather than let it fall to the page.
    if (ran) requestAnimationFrame(() => statusRef.current?.focus());
  }

  const blocked = readOnly
    ? "Read-only: enable Write mode in the header to rename."
    : problems > 0
      ? `Fix ${plural(problems, "ticked name")} first.`
      : ready.length === 0
        ? "Tick the projects to rename."
        : ready.length > MAX_RENAMES
          ? `One review covers up to ${MAX_RENAMES} projects; untick ${ready.length - MAX_RENAMES}.`
          : undefined;

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState>No projects to rename.</EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Projects"
        subtitle={
          randomRows.length === 0
            ? "None of them look like the random names Railway picks. Tick any project to rename it."
            : `${plural(randomRows.length, "project")} of ${rows.length} still ${randomRows.length === 1 ? "has" : "have"} the random name Railway picked. ${
                prefilled === randomRows.length
                  ? `${randomRows.length === 1 ? "It's" : "They're"} ticked, with a suggested name.`
                  : prefilled > 0
                    ? `${prefilled} ${prefilled === 1 ? "is" : "are"} ticked with a suggested name; type one for the rest.`
                    : "Type a name for each one you want to rename."
              } Edit or untick any of them.`
        }
        actions={
          <>
            <button type="button" className={buttonClass("ghost")} onClick={tickRandom} disabled={randomRows.length === 0}>
              Tick random names
            </button>
            <button type="button" className={buttonClass("ghost")} onClick={untickAll}>
              Untick all
            </button>
          </>
        }
      />

      <div aria-hidden="true" className="hidden grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-3 border-b border-line px-4 py-2 text-xs font-medium text-ink-2 sm:grid">
        <span />
        <span>Project</span>
        <span>New name</span>
      </div>
      <ul aria-label="Projects to rename" className="divide-y divide-[var(--border)]">
        {rows.map((row) => (
          <RenameRowItem
            key={row.key}
            row={row}
            draft={draftFor(drafts, row)}
            check={checks.get(row.key) ?? { state: "off" }}
            clash={clashes.has(row.key)}
            onToggle={(checked) => toggle(row, checked)}
            onEdit={(value) => edit(row, value)}
            onUseSuggestion={() => applySuggestion(row)}
            inputRef={(el) => {
              if (el) inputs.current.set(row.key, el);
              else inputs.current.delete(row.key);
            }}
          />
        ))}
      </ul>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-b-xl border-t border-line bg-surface px-4 py-3">
        <p ref={statusRef} tabIndex={-1} className="rounded-sm text-sm text-ink-2" aria-live="polite">
          <span className="font-medium text-ink">{plural(ready.length, "rename")}</span> ready
          {blocked ? ` · ${blocked}` : ""}
        </p>
        <button
          type="button"
          className={buttonClass("primary", "md")}
          disabled={!!blocked}
          title={blocked}
          onClick={() => setReview(ready.map(({ row, name }) => ({ projectId: row.projectId, newName: name })))}
        >
          <Icon name="pencil" size={13} /> Review {ready.length > 0 ? plural(ready.length, "rename") : "renames"}
        </button>
      </div>

      {review && <RenameDialog items={review} onClose={closeReview} />}
    </Card>
  );
}

function RenameRowItem({
  row,
  draft,
  check,
  clash,
  onToggle,
  onEdit,
  onUseSuggestion,
  inputRef,
}: {
  row: RenameRow;
  draft: Draft;
  check: Check;
  clash: boolean;
  onToggle: (checked: boolean) => void;
  onEdit: (value: string) => void;
  onUseSuggestion: () => void;
  inputRef: (el: HTMLInputElement | null) => void;
}) {
  const id = useId();
  const locked = !!row.lockReason;
  const suggestion = row.suggestion;
  const usingSuggestion = !!suggestion && draft.value.trim() === suggestion.name;

  let hint: React.ReactNode = null;
  if (locked) {
    hint = `${row.lockReason}, so it can't be renamed here.`;
  } else if (check.state === "problem") {
    hint = (
      <span className="inline-flex items-start gap-1 text-ink">
        <Icon name="alert" size={12} color="var(--status-critical)" className="mt-0.5 shrink-0" /> {check.message}
      </span>
    );
  } else if (clash) {
    hint = (
      <span className="inline-flex items-start gap-1 text-ink">
        <Icon name="alert" size={12} color="var(--status-warning)" className="mt-0.5 shrink-0" /> Another project in {row.workspaceName} would have this name
        too.
      </span>
    );
  } else if (suggestion && usingSuggestion) {
    hint = `Suggested from ${SOURCE_LABEL[suggestion.source]}.`;
  } else if (suggestion) {
    hint = (
      <>
        <button type="button" className="text-link underline-offset-2 hover:underline" onClick={onUseSuggestion}>
          Use “{suggestion.name}”
        </button>{" "}
        · from {SOURCE_LABEL[suggestion.source]}
      </>
    );
  } else if (row.generated) {
    hint = "No GitHub repo to suggest a name from.";
  }

  return (
    <li
      data-rename-row={row.projectId}
      className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1.2fr)]"
    >
      <input
        id={`${id}-tick`}
        type="checkbox"
        className="mt-1 size-4 accent-[var(--series-1)]"
        checked={draft.checked && !locked}
        disabled={locked}
        onChange={(e) => onToggle(e.target.checked)}
      />
      <div className="min-w-0 pt-0.5">
        <label htmlFor={`${id}-tick`} className="block font-medium break-words">
          {row.name}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-2">
          {row.generated && <Badge title="Looks like the random two-word name Railway gives new projects">generated name</Badge>}
          {locked && (
            <Badge title={row.lockReason}>
              <Icon name="lock" size={10} /> {row.lockReason === "Listed in PROTECTED_PROJECTS" ? "protected" : "locked"}
            </Badge>
          )}
          <span className="break-words">
            {row.workspaceName} · {row.repos.length > 0 ? row.repos.join(", ") : "no GitHub repo"}
          </span>
        </div>
      </div>
      <div className="col-start-2 min-w-0 sm:col-start-3">
        <label htmlFor={`${id}-name`} className="sr-only">
          New name for {row.name}
        </label>
        <input
          ref={inputRef}
          id={`${id}-name`}
          value={draft.value}
          onChange={(e) => onEdit(e.target.value)}
          disabled={locked}
          maxLength={NAME_MAX}
          placeholder={locked ? "" : "New name"}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={check.state === "problem" || undefined}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className="w-full rounded-md border border-line-strong bg-page px-2 py-1.5 text-sm outline-none focus:border-(--series-1) disabled:opacity-60"
        />
        {hint && (
          <div id={`${id}-hint`} className="mt-1 text-xs text-ink-2">
            {hint}
          </div>
        )}
      </div>
    </li>
  );
}

// ── Review dialog ───────────────────────────────────────────────────────────

type Phase =
  | { name: "loading" }
  | { name: "error"; message: string }
  | { name: "review"; plan: RenamePlanView; error?: string }
  | { name: "running"; plan: RenamePlanView }
  | { name: "done"; plan: RenamePlanView; result: RenameExecutionView };

function RenameDialog({ items, onClose }: { items: RenameRequestItem[]; onClose: (ran: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const titleId = useId();
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [attempt, setAttempt] = useState(0);
  const ran = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPhase({ name: "loading" });
    createRenamePlanAction({ items }).then(
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
    // The items are fixed for the lifetime of this dialog; `attempt` re-runs the review.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const running = phase.name === "running";
  const plan = phase.name === "review" || phase.name === "running" || phase.name === "done" ? phase.plan : null;
  const canApprove = phase.name === "review" && !!plan && !plan.blockedReason && plan.runnableCount > 0;

  function handleClosed() {
    onClose(ran.current);
    // Refresh the table underneath once the results have been read. Even a run where everything
    // was skipped means the table may be out of date (a project renamed elsewhere).
    if (ran.current) router.refresh();
  }

  async function approve(next: RenamePlanView) {
    setPhase({ name: "running", plan: next });
    try {
      const res = await executeRenamePlanAction(next.id);
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
            {plan?.title ?? (phase.name === "error" ? "Couldn't prepare this review" : "Reading projects from Railway…")}
          </h2>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm">
          {phase.name === "loading" && (
            <p className="flex items-center gap-2 text-ink-2">
              <Icon name="loader" size={16} className="animate-spin" /> Re-reading each project from Railway. Nothing is changed at this step.
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

              {plan.items.length > 0 && (
                <section>
                  <h3 className="font-semibold">
                    Projects ({plan.runnableCount} of {plan.items.length} will be renamed)
                  </h3>
                  <ul className="mt-1.5 divide-y divide-[var(--border)] rounded-lg border border-line">
                    {plan.items.map((item) => (
                      <PlanRow key={item.key} item={item} />
                    ))}
                  </ul>
                </section>
              )}

              {phase.name === "review" && phase.error && <Callout tone="danger">{phase.error}</Callout>}
              <p className="text-xs text-ink-2">
                This review is valid for 10 minutes and can be used once. Each project is re-read right before it&apos;s renamed; any that was
                renamed since this review is skipped.
              </p>
            </>
          )}

          {phase.name === "done" && <Results result={phase.result} />}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {phase.name === "done" ? (
            // Keyed so React mounts a new button (and autoFocus runs) instead of reusing Cancel's.
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
                      <Icon name="loader" size={14} className="animate-spin" /> Renaming…
                    </>
                  ) : (
                    `Rename ${plural(plan.runnableCount, "project")}`
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

function PlanRow({ item }: { item: RenamePlanItem }) {
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <div className="break-words">
            <span className="text-ink-2">{item.before}</span> <span className="text-ink-2">→</span> <span className="font-medium">{item.after}</span>
          </div>
          <div className="text-xs break-words text-ink-2">{item.workspaceName}</div>
        </div>
        <div className="shrink-0 text-right text-xs">
          {item.willRun ? (
            <div className="inline-flex items-center gap-1 font-medium">
              <Icon name="check" size={12} color="var(--status-good)" /> will rename
            </div>
          ) : (
            <div className="max-w-[18rem] text-ink-2">
              <span className="font-medium text-ink">skipped</span> — {item.skipReason}
            </div>
          )}
        </div>
      </div>
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
