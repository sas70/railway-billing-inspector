/** Types shared by the server (plans.ts) and the review dialog in the browser. */

export const PLAN_KINDS = [
  "deployment.remove",
  "deployment.restart",
  "deployment.redeploy",
  "deployment.rollback",
  "deployment.cancel",
  "service.delete",
  "environment.delete",
  "project.scheduleDelete",
  "project.cancelDelete",
] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

/** What the browser asks for. The server re-reads everything from Railway before showing a plan. */
export type PlanRequest = {
  accountKey: string;
  kind: PlanKind;
  projectId: string;
  environmentId?: string;
  serviceId?: string;
  targetIds: string[];
};

export type PlanFlag = { tone: "danger" | "warning" | "info"; text: string };

export type PlanItem = {
  targetId: string;
  label: string;
  detail?: string;
  status?: string;
  flags: PlanFlag[];
  willRun: boolean;
  skipReason?: string;
};

export type PlanView = {
  id: string;
  kind: PlanKind;
  title: string;
  /** Button verb, e.g. "Remove" */
  verb: string;
  destructive: boolean;
  context: { account: string; workspace?: string; project: string; environment?: string; service?: string };
  impact: string[];
  recovery?: string;
  items: PlanItem[];
  runnableCount: number;
  requiresPhrase: boolean;
  /** Exact text the user must type to approve (empty when not required). */
  phrase: string;
  blockedReason?: string;
  expiresAt: string;
  demo: boolean;
};

export type ExecutionItemResult = {
  targetId: string;
  label: string;
  /** "unknown": the request was sent but no clear answer came back (timeout / 5xx) — check Railway. */
  outcome: "success" | "failed" | "skipped" | "unknown";
  message?: string;
  traceIds?: string[];
};

export type ExecutionView = {
  planId: string;
  kind: PlanKind;
  title: string;
  results: ExecutionItemResult[];
  succeeded: number;
  failed: number;
  skipped: number;
  unknown: number;
  auditWritten: boolean;
  auditError?: string;
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
