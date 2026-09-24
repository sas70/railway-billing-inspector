import type { Health } from "./health";

/** One service instance in one environment — the unit of the Services dashboard. */
export type ServiceCatalogRow = {
  key: string;
  accountKey: string;
  workspaceName: string;
  projectId: string;
  projectName: string;
  protected: boolean;
  serviceId: string;
  serviceName: string;
  environmentId: string;
  environmentName: string;
  isPrimary: boolean;
  isEphemeral: boolean;
  health: Health;
  degraded: boolean;
  online: boolean;
  liveDeploymentIds: string[];
  latestId: string | null;
  latestAt: string | null;
  latestLabel: string;
  href: string;
  periodCost: number | null;
  expectedCost: number | null;
  costIsAllEnvs: boolean;
};
