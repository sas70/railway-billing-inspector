/**
 * Response shapes for the GraphQL documents in ./documents.ts.
 * Field names mirror Railway's public schema (verified with `npm run check:queries`).
 */

export type Plan = "FREE" | "HOBBY" | "PRO";

export type DeploymentStatus =
  | "BUILDING"
  | "CRASHED"
  | "DEPLOYING"
  | "FAILED"
  | "INITIALIZING"
  | "NEEDS_APPROVAL"
  | "QUEUED"
  | "REMOVED"
  | "REMOVING"
  | "SKIPPED"
  | "SLEEPING"
  | "SUCCESS"
  | "WAITING";

export type Edges<T> = { edges: { node: T }[] };
export type PageInfo = { hasNextPage: boolean; endCursor: string | null };

/** Railway's DeploymentMeta is an untyped JSON scalar (commit message, branch, reason, …). */
export type DeploymentMeta = Record<string, unknown>;

// ── Identity & workspaces ────────────────────────────────────────────────────

export type WorkspaceBasics = { id: string; name: string; plan: Plan };

export type MeResult = {
  me: { id: string; name: string | null; email: string; workspaces: WorkspaceBasics[] };
};

export type WorkspaceInfoResult = { workspace: WorkspaceBasics };

export type TokenProbeResult = {
  projects: Edges<{ id: string; workspace: WorkspaceBasics | null }>;
};

// ── Billing ─────────────────────────────────────────────────────────────────

export type BillingPeriod = { start: string; end: string };

export type CustomerBilling = {
  id: string;
  state: string;
  isTrialing: boolean;
  trialDaysRemaining: number;
  /** Dollars. Cached by Railway, may lag a little. */
  currentUsage: number;
  creditBalance: number;
  appliedCredits: number;
  remainingUsageCreditBalance: number;
  billingPeriod: BillingPeriod;
  usageLimit: { softLimit: number; hardLimit: number | null; isOverLimit: boolean } | null;
  subscriptions: {
    id: string;
    status: string;
    /** Fixes the day of month each billing period starts on. */
    billingCycleAnchor: string;
    nextInvoiceDate: string;
    /** Stripe amount in cents */
    nextInvoiceCurrentTotal: number;
    cancelAtPeriodEnd: boolean;
  }[];
};

export type WorkspaceBillingResult = {
  workspace: WorkspaceBasics & { customer: CustomerBilling };
};

export type Invoice = {
  invoiceId: string;
  periodStart: string;
  periodEnd: string;
  /** Stripe amounts in cents */
  total: number;
  amountDue: number;
  amountPaid: number;
  status: string | null;
  hostedURL: string | null;
  pdfURL: string | null;
};

export type WorkspaceInvoicesResult = {
  workspace: { id: string; customer: { id: string; invoices: Invoice[] } };
};

// ── Projects (overview) ──────────────────────────────────────────────────────

export type DeploymentLite = {
  id: string;
  status: DeploymentStatus;
  createdAt?: string;
  deploymentStopped?: boolean;
  meta?: DeploymentMeta | null;
};

export type ServiceInstanceLite = {
  id: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  latestDeployment: (DeploymentLite & { createdAt: string }) | null;
  activeDeployments: DeploymentLite[];
};

export type ProjectNode = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  workspaceId: string | null;
  primaryEnvironmentId: string | null;
  prDeploys: boolean;
  services: Edges<{ id: string; name: string; icon: string | null }>;
  environments: Edges<{
    id: string;
    name: string;
    isEphemeral: boolean;
    serviceInstances: Edges<ServiceInstanceLite>;
  }>;
};

export type WorkspaceProjectsResult = {
  projects: Edges<ProjectNode> & { pageInfo: PageInfo };
};

// ── Usage ───────────────────────────────────────────────────────────────────

export type UsageRow = {
  measurement: string;
  value: number;
  tags: { projectId: string | null; serviceId: string | null; environmentId: string | null };
};

export type WorkspaceUsageResult = {
  usage: UsageRow[];
  projects: Edges<{
    id: string;
    name: string;
    deletedAt: string | null;
    services: Edges<{ id: string; name: string; deletedAt: string | null }>;
  }>;
};

export type EstimatedRow = { measurement: string; estimatedValue: number; projectId: string };

export type WorkspaceEstimatedResult = { estimatedUsage: EstimatedRow[] };

// ── Project detail ──────────────────────────────────────────────────────────

export type ProjectDetailResult = {
  project: {
    id: string;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    workspaceId: string | null;
    primaryEnvironmentId: string | null;
    prDeploys: boolean;
    workspace: WorkspaceBasics | null;
    services: Edges<{ id: string; name: string; icon: string | null; createdAt: string }>;
    environments: Edges<{
      id: string;
      name: string;
      isEphemeral: boolean;
      createdAt: string;
      meta: { prNumber: number | null; prTitle: string | null; branch: string | null } | null;
      serviceInstances: Edges<{ serviceId: string }>;
    }>;
  };
};

export type InstanceDetail = {
  id: string;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  numReplicas: number | null;
  region: string | null;
  sleepApplication: boolean | null;
  cronSchedule: string | null;
  nextCronRunAt: string | null;
  source: { repo: string | null; image: string | null } | null;
  latestDeployment: (DeploymentLite & { createdAt: string }) | null;
  activeDeployments: (DeploymentLite & { createdAt: string })[];
  domains: { serviceDomains: { domain: string }[]; customDomains: { domain: string }[] };
};

export type VolumeInstanceNode = {
  id: string;
  serviceId: string | null;
  mountPath: string;
  currentSizeMB: number;
  sizeMB: number;
  state: string | null;
  isPendingDeletion: boolean;
  volume: { id: string; name: string };
};

export type EnvironmentDetailResult = {
  environment: {
    id: string;
    name: string;
    isEphemeral: boolean;
    serviceInstances: Edges<InstanceDetail>;
    volumeInstances: Edges<VolumeInstanceNode>;
  };
};

export type ServiceInstanceDetailResult = {
  serviceInstance: InstanceDetail & { restartPolicyType: string; startCommand: string | null };
};

// ── Deployments ─────────────────────────────────────────────────────────────

export type DeploymentNode = {
  id: string;
  status: DeploymentStatus;
  createdAt: string;
  updatedAt: string;
  statusUpdatedAt: string | null;
  staticUrl: string | null;
  canRedeploy: boolean;
  canRollback: boolean;
  deploymentStopped: boolean;
  meta: DeploymentMeta | null;
  creator: { name: string | null; email: string } | null;
};

export type ServiceDeploymentsResult = {
  deployments: Edges<DeploymentNode> & { pageInfo: PageInfo };
};

export type DeploymentReviewNode = {
  id: string;
  status: DeploymentStatus;
  createdAt: string;
  projectId: string;
  serviceId: string | null;
  environmentId: string;
  canRedeploy: boolean;
  canRollback: boolean;
  deploymentStopped: boolean;
  meta: DeploymentMeta | null;
  service: { id: string; name: string };
  environment: { id: string; name: string };
};

export type DeploymentForReviewResult = { deployment: DeploymentReviewNode };

// ── Metrics & logs ──────────────────────────────────────────────────────────

export type MetricsResult = {
  metrics: { measurement: string; values: { ts: number; value: number }[] }[];
};

export type LogLine = { timestamp: string; message: string; severity: string | null };

export type RuntimeLogsResult = { deploymentLogs: LogLine[] };
export type BuildLogsResult = { buildLogs: LogLine[] };
