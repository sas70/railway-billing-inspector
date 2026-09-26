"use client";

import { useState } from "react";

import { ReviewDialog } from "@/components/ActionReview";
import { buttonClass } from "@/components/button";
import { Icon } from "@/components/Icon";
import { Badge } from "@/components/ui";
import { isGeneratedRailwayName } from "@/lib/project-name";

export function ProjectRename({
  accountKey,
  projectId,
  currentName,
  readOnly,
  lockedReason,
}: {
  accountKey: string;
  projectId: string;
  currentName: string;
  readOnly: boolean;
  lockedReason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [review, setReview] = useState(false);
  const generated = isGeneratedRailwayName(currentName);
  const next = draft.trim().replace(/\s+/g, " ");
  const ready = next.length >= 1 && next.length <= 64 && next !== currentName;
  const disabled = readOnly || !!lockedReason;
  const disabledReason = lockedReason ?? (readOnly ? "Read-only — enable Write mode in the header" : undefined);

  function startReview() {
    if (!ready || disabled) return;
    setReview(true);
  }

  return (
    <div className="mt-1.5">
      {!open ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {generated && (
            <Badge title="Railway assigned this two-word name">generated name</Badge>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink"
            disabled={disabled}
            title={disabled ? disabledReason : "Give this project a clearer name"}
            onClick={() => {
              setDraft(generated ? "" : currentName);
              setOpen(true);
            }}
          >
            <Icon name="pencil" size={11} />
            Rename
          </button>
        </div>
      ) : (
        <form
          className="mt-1 flex max-w-xs flex-wrap items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            startReview();
          }}
        >
          <label className="sr-only" htmlFor={`rename-${projectId}`}>
            New name for {currentName}
          </label>
          <input
            id={`rename-${projectId}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={generated ? "e.g. roomgpt-api" : currentName}
            maxLength={64}
            disabled={disabled || review}
            autoFocus
            className="min-w-40 flex-1 rounded-md border border-line-strong bg-page px-2 py-1 text-xs outline-none focus:border-(--series-1)"
          />
          <button type="submit" className={buttonClass("primary", "sm")} disabled={!ready || disabled || review}>
            Review
          </button>
          <button
            type="button"
            className="text-xs text-ink-2 hover:text-ink"
            onClick={() => {
              setOpen(false);
              setDraft("");
            }}
          >
            Cancel
          </button>
        </form>
      )}
      {review && (
        <ReviewDialog
          request={{
            accountKey,
            kind: "project.rename",
            projectId,
            targetIds: [projectId],
            newName: next,
          }}
          onClose={() => {
            setReview(false);
            setOpen(false);
            setDraft("");
          }}
        />
      )}
    </div>
  );
}
