"use client";

import { useState, useTransition } from "react";

import { explainVolumeAction } from "@/app/actions";
import { dateShort, money, sizeMB } from "@/lib/format";
import type { VolumeKind } from "@/lib/volume-kind";
import type { VolumeNote } from "@/lib/volume-insight";
import { buttonClass } from "./button";
import { Icon } from "./Icon";
import { Badge } from "./ui";

/**
 * "What's in it?" for one volume: an instant guess from the image and mount path, and, on request,
 * Claude's explanation using the code too. Both are labeled as inferences: Railway's API can't list
 * a volume's files.
 */
export function VolumeInsight({
  request,
  kind,
  usedMB,
  perDay,
  attachedName,
  running,
  initialNote,
  aiAvailable,
}: {
  request: { accountKey: string; projectId: string; environmentId: string; volumeId: string };
  kind: VolumeKind;
  usedMB: number;
  perDay: number;
  attachedName: string | null;
  running: boolean;
  initialNote: VolumeNote | null;
  aiAvailable: boolean;
}) {
  const [note, setNote] = useState(initialNote);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const ask = () =>
    start(async () => {
      setError(null);
      const res = await explainVolumeAction(request);
      if (res.ok) setNote(res.data);
      else setError(res.error);
    });

  const grew = note && Math.abs(note.usedMB - usedMB) / Math.max(usedMB, 1) > 0.1;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">Most likely: {kind.label}</span>
          <Badge title="Railway's API can't list the files in a volume">
            {kind.basis === "image" ? "guess from the image" : kind.basis === "path" ? "guess from the mount path" : "unknown"}
          </Badge>
        </div>
        <p className="mt-1 text-ink-2">
          {sizeMB(usedMB)} stored, about {money(perDay)} a day ({money(perDay * 30)} a month) until it is deleted
          {attachedName ? `, ${running ? "used by" : "attached to"} ${attachedName}${running ? ", which is running" : ", which isn't running"}` : ", not attached to any service"}
          . {kind.contents}
        </p>
      </div>

      {note && (
        <div className="rounded-lg border border-line bg-page p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
            <Icon name="info" size={12} /> Claude&apos;s explanation · {note.note.confidence} confidence · {note.demo ? "demo" : dateShort(note.generatedAt)}
            {grew && <Badge tone="warning">size changed since ({sizeMB(note.usedMB)} then)</Badge>}
          </div>
          <p className="mt-1.5 font-medium">{note.note.headline}</p>
          <p className="mt-1">{note.note.explanation}</p>
          {note.note.likelyContents.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-ink-2">
              {note.note.likelyContents.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-ink-2">
            <span className="font-medium text-ink">Before deleting:</span> {note.note.beforeDeleting}
          </p>
        </div>
      )}

      {!note && <p className="text-xs text-ink-2">To keep a copy: {kind.keepCopy}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {aiAvailable ? (
          <button type="button" className={buttonClass("neutral")} onClick={ask} disabled={pending}>
            <Icon name={pending ? "loader" : "search"} size={12} className={pending ? "animate-spin" : undefined} />
            {pending ? "Reading the code…" : note ? "Explain again" : "Explain with Claude"}
          </button>
        ) : (
          <span className="text-xs text-ink-2">Set ANTHROPIC_API_KEY in .env.local for a fuller explanation from the code.</span>
        )}
        {error && (
          <span className="inline-flex items-center gap-1 text-xs" role="alert">
            <Icon name="alert" size={12} color="var(--status-critical)" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
