"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { startSummariesAction } from "@/app/actions";
import type { SummaryJob } from "@/lib/code/ai-summary";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

/** Start AI summaries and show progress; refreshes the page while the background job runs. */
export function SummaryControls({ job, missing, total }: { job: SummaryJob; missing: number; total: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job.running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [job.running, router]);

  const start = (mode: "missing" | "all") =>
    startTransition(async () => {
      setError(null);
      const result = await startSummariesAction(mode);
      if (!result.ok) setError(result.error);
      router.refresh();
    });

  if (job.running) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2" role="status">
        <Icon name="loader" size={12} className="animate-spin" />
        Summarizing {job.done} / {job.total}
        {job.current.length > 0 && <span className="font-mono">· {job.current.join(", ")}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-xs text-(--status-critical)">{error}</span>}
      {job.finishedAt && job.total > 0 && (
        <span className="text-xs text-ink-2">
          Last run: {job.created} new, {job.updated} updated, {job.fresh} unchanged
          {job.failed.length > 0 && <span title={job.failed.map((f) => `${f.repo}: ${f.error}`).join("\n")}>, {job.failed.length} failed</span>}
        </span>
      )}
      {missing > 0 ? (
        <button type="button" className={buttonClass("primary")} disabled={pending} onClick={() => start("missing")}>
          <Icon name="code" size={12} /> Summarize {missing} {missing === 1 ? "repo" : "repos"} with Claude
        </button>
      ) : (
        <button
          type="button"
          className={buttonClass("ghost")}
          disabled={pending || total === 0}
          onClick={() => start("all")}
          title="Re-read every repo and regenerate its summary, even if the code hasn't changed"
        >
          <Icon name="refresh" size={12} /> Re-summarize all
        </button>
      )}
    </div>
  );
}
