"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { summaryJobAction } from "@/app/actions";
import type { SummaryJob } from "@/lib/code/ai-summary";
import { plural } from "@/lib/format";
import { Icon } from "./Icon";

/**
 * A quiet status line while project summaries are written in the background. When the job ends it
 * reloads the page once, so the new summaries (and rename suggestions built from them) show up.
 */
export function SummaryProgress({ initial }: { initial: SummaryJob }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const wasRunning = useRef(initial.running);

  useEffect(() => {
    if (!job.running) return;
    const timer = setInterval(async () => {
      const res = await summaryJobAction();
      if (res.ok) setJob(res.data.job);
    }, 4000);
    return () => clearInterval(timer);
  }, [job.running]);

  useEffect(() => {
    if (wasRunning.current && !job.running) router.refresh();
    wasRunning.current = job.running;
  }, [job.running, router]);

  if (!job.running && !(job.finishedAt && job.failed.length > 0 && job.total > 0)) return null;
  if (!job.running) {
    return (
      <p className="text-xs text-ink-2" role="status">
        Summaries: {job.created + job.updated} written, {plural(job.failed.length, "repo")} couldn&apos;t be read ({job.failed.slice(0, 3).map((f) => f.repo).join(", ")}
        {job.failed.length > 3 ? "…" : ""}). They&apos;re tried again the next time the app starts.
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2" role="status">
      <Icon name="loader" size={12} className="animate-spin" />
      Writing summaries for projects that don&apos;t have one: {job.done} of {job.total}
      {job.current.length > 0 && <span className="font-mono">· {job.current.join(", ")}</span>}
    </p>
  );
}
