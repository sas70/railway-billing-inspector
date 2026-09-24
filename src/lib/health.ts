import type { DeploymentLite, DeploymentStatus } from "./railway/types";

/** What a service instance is doing right now, derived from its deployments. */
export type Health = "live" | "sleeping" | "deploying" | "crashed" | "failed" | "offline";

export const IN_PROGRESS: ReadonlySet<DeploymentStatus> = new Set([
  "BUILDING",
  "DEPLOYING",
  "INITIALIZING",
  "QUEUED",
  "WAITING",
  "NEEDS_APPROVAL",
]);

export const GONE: ReadonlySet<DeploymentStatus> = new Set(["REMOVED", "REMOVING"]);

export type HealthResult = {
  health: Health;
  /** An older deployment is still serving, but the newest one failed or crashed. */
  degraded: boolean;
  liveDeploymentIds: string[];
};

export function instanceHealth(
  latest: Pick<DeploymentLite, "id" | "status"> | null | undefined,
  active: Pick<DeploymentLite, "id" | "status" | "deploymentStopped">[] | null | undefined,
): HealthResult {
  const activeList = active ?? [];
  const running = activeList.filter((d) => d.status === "SUCCESS" && !d.deploymentStopped);
  const liveDeploymentIds = activeList.filter((d) => !d.deploymentStopped && !GONE.has(d.status)).map((d) => d.id);

  if (running.length) {
    const degraded =
      !!latest && (latest.status === "FAILED" || latest.status === "CRASHED") && !running.some((d) => d.id === latest.id);
    return { health: "live", degraded, liveDeploymentIds };
  }
  if (activeList.some((d) => d.status === "SLEEPING" && !d.deploymentStopped)) {
    return { health: "sleeping", degraded: false, liveDeploymentIds };
  }
  if (latest && IN_PROGRESS.has(latest.status)) return { health: "deploying", degraded: false, liveDeploymentIds };
  if (latest?.status === "CRASHED" || activeList.some((d) => d.status === "CRASHED")) {
    return { health: "crashed", degraded: false, liveDeploymentIds };
  }
  if (latest?.status === "FAILED") return { health: "failed", degraded: false, liveDeploymentIds };
  return { health: "offline", degraded: false, liveDeploymentIds };
}

export type HealthCounts = Record<Health, number> & { degraded: number; total: number };

export const emptyHealthCounts = (): HealthCounts => ({
  live: 0,
  sleeping: 0,
  deploying: 0,
  crashed: 0,
  failed: 0,
  offline: 0,
  degraded: 0,
  total: 0,
});

export function needsAttention(counts: HealthCounts) {
  return counts.crashed + counts.failed + counts.degraded;
}

/** Live, sleeping and deploying count as on; crashed / failed / removed count as off. */
export function isOnlineHealth(health: Health): boolean {
  return health === "live" || health === "sleeping" || health === "deploying";
}
