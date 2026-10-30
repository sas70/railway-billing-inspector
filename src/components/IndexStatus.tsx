"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { indexStatusAction, startIndexAction } from "@/app/actions";
import type { IndexJob } from "@/lib/search-index/build";
import type { IndexStats } from "@/lib/search-index/store";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

const PHASE: Record<NonNullable<IndexJob["phase"]>, string> = {
  projects: "Reading projects",
  repos: "Reading code",
  topics: "Learning what each project is about",
  done: "Done",
};

function ago(iso: string | null, now: number | null): string {
  if (!iso || now == null) return "";
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.floor(hours / 24)} days ago`;
}

/**
 * The search index's state, with Update and Rebuild. While the background job runs it polls for
 * progress, and refreshes the page once it finishes so results use the new index.
 */
export function IndexStatus({ job: initialJob, stats: initialStats, topicNote }: { job: IndexJob; stats: IndexStats; topicNote: string | null }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [stats, setStats] = useState(initialStats);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const wasRunning = useRef(initialJob.running);

  useEffect(() => {
    setJob(initialJob);
    setStats(initialStats);
  }, [initialJob, initialStats]);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!job.running) return;
    const id = setInterval(async () => {
      const res = await indexStatusAction();
      if (!res.ok) return;
      setJob(res.data.job);
      setStats(res.data.stats);
    }, 2000);
    return () => clearInterval(id);
  }, [job.running]);

  useEffect(() => {
    if (wasRunning.current && !job.running) router.refresh();
    wasRunning.current = job.running;
  }, [job.running, router]);

  const start = (mode: "update" | "rebuild") =>
    startTransition(async () => {
      setError(null);
      const res = await startIndexAction(mode);
      if (!res.ok) return setError(res.error);
      const status = await indexStatusAction();
      if (status.ok) {
        setJob(status.data.job);
        setStats(status.data.stats);
      }
    });

  const empty = stats.projects === 0;
  const percent = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-xs text-ink-2" role="status" aria-live="polite">
      {job.running ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <Icon name="loader" size={12} className="animate-spin" /> Building the search index: {job.phase ? PHASE[job.phase] : "Starting"}
            {job.total > 0 && job.phase !== "projects" && ` · ${job.done} / ${job.total}`}
          </span>
          {job.total > 0 && job.phase !== "projects" && (
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
              <span className="block h-full rounded-full bg-(--series-1) transition-[width]" style={{ width: `${percent}%` }} />
            </span>
          )}
          {job.current.length > 0 && <span className="truncate font-mono">{job.current.join(", ")}</span>}
          {!empty && <span>Search uses what's indexed so far.</span>}
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5 font-medium text-ink">
            <Icon name="database" size={12} /> Search index
          </span>
          {empty ? (
            <span>Not built yet.</span>
          ) : (
            <>
              <span>
                {stats.projects} projects · {stats.repos} repos · {stats.chunks.toLocaleString()} code chunks
              </span>
              <span title={topicNote ?? `Topic search compares what each project does using ${stats.model ?? "a local model"}, on this machine.`}>
                Topic search {stats.topics > 0 && !topicNote ? "on" : "off"}
              </span>
              {stats.builtAt && <span>updated {ago(stats.builtAt, now)}</span>}
              {job.failed.length > 0 && (
                <span className="text-(--status-warning)" title={job.failed.map((f) => `${f.repo}: ${f.error}`).join("\n")}>
                  {job.failed.length} repo{job.failed.length === 1 ? "" : "s"} couldn't be read
                </span>
              )}
            </>
          )}
          {job.error && <span className="text-(--status-critical)">Last run failed: {job.error}</span>}
          {error && <span className="text-(--status-critical)">{error}</span>}
        </div>
      )}
      {!job.running && (
        <span className="flex items-center gap-1.5">
          <button type="button" className={buttonClass(empty ? "primary" : "ghost", "sm")} disabled={pending} onClick={() => start("update")} title="Re-read only what changed since the last run">
            <Icon name="refresh" size={12} /> {empty ? "Build index" : "Update"}
          </button>
          {!empty && (
            <button type="button" className={buttonClass("ghost", "sm")} disabled={pending} onClick={() => start("rebuild")} title="Throw the index away and read everything again">
              Rebuild
            </button>
          )}
        </span>
      )}
    </div>
  );
}
