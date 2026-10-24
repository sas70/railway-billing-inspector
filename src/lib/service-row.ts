import type { Health } from "./health";
import type { RepoBlurb } from "./repo-blurb";

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
  /** GitHub `owner/name` the service deploys from, if any. */
  repo: string | null;
  /** The project's Railway description: the hover card's fallback where no saved summary is readable (e.g. on Vercel). */
  projectDescription: string | null;
  /** What that repo does, for the hover card (added by the Services page). */
  blurb?: RepoBlurb | null;
};
