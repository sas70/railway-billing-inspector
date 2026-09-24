import type { ExecutionItemResult, PlanFlag } from "./plan-types";

export type BulkMode = "on" | "off";

/** What the browser sends. The server re-reads Railway before anything is approved. */
export type BulkTargetInput = {
  accountKey: string;
  projectId: string;
  projectName: string;
  workspaceName: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
  liveDeploymentIds: string[];
  latestId: string | null;
};

export type BulkPlanItem = {
  key: string;
  accountKey: string;
  accountLabel: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
  targetId: string;
  kind: "deployment.remove" | "deployment.redeploy";
  label: string;
  detail?: string;
  status?: string;
  flags: PlanFlag[];
  willRun: boolean;
  skipReason?: string;
  reviewedLive: boolean;
};

export type BulkPlanView = {
  id: string;
  mode: BulkMode;
  title: string;
  verb: string;
  destructive: boolean;
  impact: string[];
  recovery?: string;
  items: BulkPlanItem[];
  runnableCount: number;
  requiresPhrase: boolean;
  phrase: string;
  blockedReason?: string;
  expiresAt: string;
  demo: boolean;
};

export type BulkExecutionView = {
  planId: string;
  mode: BulkMode;
  title: string;
  results: ExecutionItemResult[];
  succeeded: number;
  failed: number;
  skipped: number;
  unknown: number;
  auditWritten: boolean;
  auditError?: string;
};
