import type { ExecutionItemResult, PlanFlag } from "./plan-types";

/** Types shared by describe.ts and the review dialog in the browser. */

/** Limit the review to one project (the project page's button). Omit for every project. */
export type DescribeScope = { accountKey: string; projectId: string };

export type DescribePlanItem = {
  key: string;
  accountKey: string;
  accountLabel: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  /** Railway's description at review time ("" when there is none). */
  before: string;
  /** What will be written: built on the server from the saved summaries. */
  after: string;
  repos: string[];
  flags: PlanFlag[];
  willRun: boolean;
  skipReason?: string;
};

export type DescribePlanView = {
  id: string;
  title: string;
  impact: string[];
  recovery: string;
  items: DescribePlanItem[];
  runnableCount: number;
  blockedReason?: string;
  expiresAt: string;
  demo: boolean;
};

export type DescribeExecutionView = {
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
