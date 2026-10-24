import type { Suggestion } from "./name-suggest";
import type { ExecutionItemResult, PlanFlag } from "./plan-types";

/** Types shared by rename.ts, the Rename projects page and its review dialog. */

/** One row of the rename table, built on the server from cached Railway reads. */
export type RenameRow = {
  key: string;
  accountKey: string;
  accountLabel: string;
  workspaceId: string;
  workspaceName: string;
  projectId: string;
  name: string;
  repos: string[];
  /** Looks like the random two-word name Railway gave it (isGeneratedRailwayName). */
  generated: boolean;
  /** A slug from the saved code summary or the repo name, unique across the listed projects. */
  suggestion: Suggestion | null;
  /** Set when this project can't be renamed from here (protected, outside the token's workspace). */
  lockReason?: string;
};

/** What the browser sends for review: the project and the name typed (or accepted) for it. */
export type RenameRequestItem = { projectId: string; newName: string };

export type RenamePlanItem = {
  key: string;
  accountKey: string;
  accountLabel: string;
  workspaceName: string;
  projectId: string;
  /** Railway's name at review time. */
  before: string;
  /** The approved new name, cleaned up (trimmed, spaces collapsed). */
  after: string;
  flags: PlanFlag[];
  willRun: boolean;
  skipReason?: string;
};

export type RenamePlanView = {
  id: string;
  title: string;
  impact: string[];
  recovery: string;
  items: RenamePlanItem[];
  runnableCount: number;
  blockedReason?: string;
  expiresAt: string;
  demo: boolean;
};

export type RenameExecutionView = {
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
