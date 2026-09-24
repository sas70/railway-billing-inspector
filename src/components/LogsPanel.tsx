"use client";

import { useEffect, useState } from "react";

import { fetchLogsAction } from "@/app/actions";
import { stripAnsi } from "@/lib/format";
import type { LogLine } from "@/lib/railway/types";
import { buttonClass } from "./button";
import { Icon } from "./Icon";

type State = { loading: true } | { loading: false; lines: LogLine[] } | { loading: false; error: string };

export function LogsPanel({
  accountKey,
  deploymentId,
  title,
  onClose,
}: {
  accountKey: string;
  deploymentId: string;
  title: string;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<"runtime" | "build">("runtime");
  const [state, setState] = useState<State>({ loading: true });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    fetchLogsAction(accountKey, deploymentId, kind).then(
      (res) => {
        if (!cancelled) setState(res.ok ? { loading: false, lines: res.data } : { loading: false, error: res.error });
      },
      (error: unknown) => {
        if (!cancelled) setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [accountKey, deploymentId, kind, nonce]);

  return (
    <section className="mt-4 rounded-lg border border-line bg-surface" aria-label={`Logs for ${title}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 text-sm">
          <span className="font-semibold">Logs</span> <span className="text-ink-2">· {title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div role="tablist" aria-label="Log type" className="flex rounded-md border border-line p-0.5">
            {(["runtime", "build"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={kind === k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded px-2 py-0.5 text-xs ${kind === k ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {k === "runtime" ? "Runtime" : "Build"}
              </button>
            ))}
          </div>
          <button type="button" className={buttonClass("ghost")} onClick={() => setNonce((n) => n + 1)} title="Reload logs">
            <Icon name="refresh" size={12} />
          </button>
          <button type="button" className={buttonClass("ghost")} onClick={onClose} aria-label="Close logs">
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
      <div className="max-h-96 overflow-auto bg-page px-4 py-3 font-mono text-xs leading-relaxed">
        {state.loading && <p className="text-ink-2">Loading the last 300 lines…</p>}
        {!state.loading && "error" in state && <p className="text-ink">Couldn&apos;t load logs: {state.error}</p>}
        {!state.loading && "lines" in state && state.lines.length === 0 && <p className="text-ink-2">No {kind} logs for this deployment.</p>}
        {!state.loading && "lines" in state && state.lines.length > 0 && (
          <ol>
            {state.lines.map((line, i) => {
              const isError = /^(err|error|fatal|crit)/i.test(line.severity ?? "");
              return (
                <li key={`${line.timestamp}-${i}`} className="flex gap-3 whitespace-pre-wrap break-all">
                  <time className="shrink-0 text-ink-2" dateTime={line.timestamp}>
                    {new Date(line.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>
                  {isError && <Icon name="alert" size={12} color="var(--status-critical)" className="mt-0.5 shrink-0" label="error" />}
                  <span className={isError ? "font-medium text-ink" : "text-ink"}>{stripAnsi(line.message)}</span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
