import type { AgentLimit, AgentLimitState, ComputeLimit, ComputeStatus } from "./limit-rules";
import type { ExecutionItemResult, PlanFlag } from "./plan-types";

/** Types shared by limits.ts, the Limits page and its review dialog. */

/** One workspace on the Limits page, built on the server from saved Railway reads. */
export type LimitRow = {
  key: string;
  accountKey: string;
  accountLabel: string;
  workspaceId: string;
  workspaceName: string;
  plan: string;
  period: { start: string; end: string } | null;
  daysLeft: number | null;
  compute:
    | {
        ok: true;
        limit: ComputeLimit;
        /** Railway's running total this period (dollars). */
        usage: number;
        /** Railway's projected usage at period end (dollars), when estimates could be read. */
        projected: number | null;
        isOverLimit: boolean;
        status: ComputeStatus;
      }
    | { ok: false; error: string };
  agent: { ok: true; limit: AgentLimitState; usedCents: number; custom: boolean | null } | { ok: false; error: string };
  /** Set when this workspace's limits can't be changed from here. */
  lockReason?: string;
};

/** What the browser sends for review. Only the parts present are changed. */
export type LimitRequest = {
  accountKey: string;
  workspaceId: string;
  compute?: ComputeLimit;
  agent?: AgentLimit;
};

export type LimitPlanItem = {
  key: "compute" | "agent";
  label: string;
  /** Railway's values at review time, in words. */
  before: string;
  after: string;
  flags: PlanFlag[];
  willRun: boolean;
  skipReason?: string;
};

export type LimitPlanView = {
  id: string;
  title: string;
  account: string;
  workspace: string;
  impact: string[];
  recovery: string;
  items: LimitPlanItem[];
  runnableCount: number;
  requiresPhrase: boolean;
  /** Exact text to type to approve (empty when not required). */
  phrase: string;
  blockedReason?: string;
  expiresAt: string;
  demo: boolean;
};

export type LimitExecutionView = {
  planId: string;
  title: string;
  results: ExecutionItemResult[];
  succeeded: number;
  failed: number;
  skipped: number;
  unknown: number;
  auditWritten: boolean;
  auditError?: string;
};
