/**
 * Every GraphQL operation the dashboard sends to Railway.
 *
 * Keep each document inside a `/* GraphQL *\/` template literal with no
 * interpolation: `npm run check:queries` extracts them from this file and
 * validates them against Railway's live schema.
 */

export type GqlDoc = { name: string; kind: "query" | "mutation"; query: string };

const q = (name: string, query: string): GqlDoc => ({ name, kind: "query", query });
const m = (name: string, query: string): GqlDoc => ({ name, kind: "mutation", query });

// ── Identity ────────────────────────────────────────────────────────────────

export const Me = q("Me", /* GraphQL */ `
query Me {
  me {
    id
    name
    email
    workspaces {
      id
      name
      plan
    }
  }
}`);

export const WorkspaceInfo = q("WorkspaceInfo", /* GraphQL */ `
query WorkspaceInfo($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    id
    name
    plan
  }
}`);

/** Workspace tokens can't call `me`; list a few projects to discover their workspace. */
export const TokenWorkspaceProbe = q("TokenWorkspaceProbe", /* GraphQL */ `
query TokenWorkspaceProbe {
  projects(first: 25) {
    edges {
      node {
        id
        workspace {
          id
          name
          plan
        }
      }
    }
  }
}`);

// ── Billing ─────────────────────────────────────────────────────────────────

export const WorkspaceBilling = q("WorkspaceBilling", /* GraphQL */ `
query WorkspaceBilling($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    id
    name
    plan
    customer {
      id
      state
      isTrialing
      trialDaysRemaining
      currentUsage
      creditBalance
      appliedCredits
      remainingUsageCreditBalance
      billingPeriod {
        start
        end
      }
      usageLimit {
        softLimit
        hardLimit
        isOverLimit
      }
      subscriptions {
        id
        status
        billingCycleAnchor
        nextInvoiceDate
        nextInvoiceCurrentTotal
        cancelAtPeriodEnd
      }
    }
  }
}`);

export const WorkspaceInvoices = q("WorkspaceInvoices", /* GraphQL */ `
query WorkspaceInvoices($workspaceId: String!) {
  workspace(workspaceId: $workspaceId) {
    id
    customer {
      id
      invoices {
        invoiceId
        periodStart
        periodEnd
        total
        amountDue
        amountPaid
        status
        hostedURL
        pdfURL
      }
    }
  }
}`);

// ── Projects ────────────────────────────────────────────────────────────────

export const WorkspaceProjects = q("WorkspaceProjects", /* GraphQL */ `
query WorkspaceProjects($workspaceId: String!, $after: String) {
  projects(workspaceId: $workspaceId, first: 50, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        name
        description
        createdAt
        updatedAt
        deletedAt
        workspaceId
        primaryEnvironmentId
        prDeploys
        services {
          edges {
            node {
              id
              name
              icon
            }
          }
        }
        environments {
          edges {
            node {
              id
              name
              isEphemeral
              serviceInstances {
                edges {
                  node {
                    id
                    serviceId
                    serviceName
                    environmentId
                    latestDeployment {
                      id
                      status
                      createdAt
                    }
                    activeDeployments {
                      id
                      status
                      deploymentStopped
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`);

export const ProjectDetail = q("ProjectDetail", /* GraphQL */ `
query ProjectDetail($id: String!) {
  project(id: $id) {
    id
    name
    description
    createdAt
    updatedAt
    deletedAt
    workspaceId
    primaryEnvironmentId
    prDeploys
    workspace {
      id
      name
      plan
    }
    services {
      edges {
        node {
          id
          name
          icon
          createdAt
        }
      }
    }
    environments {
      edges {
        node {
          id
          name
          isEphemeral
          createdAt
          meta {
            prNumber
            prTitle
            branch
          }
          serviceInstances {
            edges {
              node {
                serviceId
              }
            }
          }
        }
      }
    }
  }
}`);

export const EnvironmentDetail = q("EnvironmentDetail", /* GraphQL */ `
query EnvironmentDetail($environmentId: String!, $projectId: String!) {
  environment(id: $environmentId, projectId: $projectId) {
    id
    name
    isEphemeral
    serviceInstances {
      edges {
        node {
          id
          serviceId
          serviceName
          environmentId
          numReplicas
          region
          sleepApplication
          cronSchedule
          nextCronRunAt
          source {
            repo
            image
          }
          latestDeployment {
            id
            status
            createdAt
            deploymentStopped
            meta
          }
          activeDeployments {
            id
            status
            createdAt
            deploymentStopped
          }
          domains {
            serviceDomains {
              domain
            }
            customDomains {
              domain
            }
          }
        }
      }
    }
    volumeInstances {
      edges {
        node {
          id
          serviceId
          mountPath
          currentSizeMB
          sizeMB
          state
          isPendingDeletion
          volume {
            id
            name
          }
        }
      }
    }
  }
}`);

export const ServiceInstanceDetail = q("ServiceInstanceDetail", /* GraphQL */ `
query ServiceInstanceDetail($environmentId: String!, $serviceId: String!) {
  serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
    id
    serviceId
    serviceName
    environmentId
    numReplicas
    region
    sleepApplication
    cronSchedule
    nextCronRunAt
    restartPolicyType
    startCommand
    source {
      repo
      image
    }
    latestDeployment {
      id
      status
      createdAt
      deploymentStopped
    }
    activeDeployments {
      id
      status
      createdAt
      deploymentStopped
    }
    domains {
      serviceDomains {
        domain
      }
      customDomains {
        domain
      }
    }
  }
}`);

// ── Deployments ─────────────────────────────────────────────────────────────

export const ServiceDeployments = q("ServiceDeployments", /* GraphQL */ `
query ServiceDeployments($input: DeploymentListInput!, $first: Int, $after: String) {
  deployments(input: $input, first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      node {
        id
        status
        createdAt
        updatedAt
        statusUpdatedAt
        staticUrl
        canRedeploy
        canRollback
        deploymentStopped
        meta
        creator {
          name
          email
        }
      }
    }
  }
}`);

/** Re-read a single deployment right before an action is reviewed and executed. */
export const DeploymentForReview = q("DeploymentForReview", /* GraphQL */ `
query DeploymentForReview($id: String!) {
  deployment(id: $id) {
    id
    status
    createdAt
    projectId
    serviceId
    environmentId
    canRedeploy
    canRollback
    deploymentStopped
    meta
    service {
      id
      name
    }
    environment {
      id
      name
    }
  }
}`);

// ── Usage, metrics, logs ────────────────────────────────────────────────────

export const WorkspaceUsage = q("WorkspaceUsage", /* GraphQL */ `
query WorkspaceUsage(
  $workspaceId: String!
  $measurements: [MetricMeasurement!]!
  $groupBy: [MetricTag!]
  $startDate: DateTime
  $endDate: DateTime
) {
  usage(
    workspaceId: $workspaceId
    measurements: $measurements
    groupBy: $groupBy
    startDate: $startDate
    endDate: $endDate
    includeDeleted: true
  ) {
    measurement
    value
    tags {
      projectId
      serviceId
      environmentId
    }
  }
  projects(workspaceId: $workspaceId, first: 5000, includeDeleted: true) {
    edges {
      node {
        id
        name
        deletedAt
        services {
          edges {
            node {
              id
              name
              deletedAt
            }
          }
        }
      }
    }
  }
}`);

export const WorkspaceEstimatedUsage = q("WorkspaceEstimatedUsage", /* GraphQL */ `
query WorkspaceEstimatedUsage($workspaceId: String!, $measurements: [MetricMeasurement!]!) {
  estimatedUsage(workspaceId: $workspaceId, measurements: $measurements, includeDeleted: true) {
    measurement
    estimatedValue
    projectId
  }
}`);

export const ServiceMetrics = q("ServiceMetrics", /* GraphQL */ `
query ServiceMetrics(
  $projectId: String!
  $serviceId: String!
  $environmentId: String!
  $startDate: DateTime!
  $endDate: DateTime
  $measurements: [MetricMeasurement!]!
  $sampleRateSeconds: Int
) {
  metrics(
    projectId: $projectId
    serviceId: $serviceId
    environmentId: $environmentId
    startDate: $startDate
    endDate: $endDate
    measurements: $measurements
    sampleRateSeconds: $sampleRateSeconds
  ) {
    measurement
    values {
      ts
      value
    }
  }
}`);

export const DeploymentRuntimeLogs = q("DeploymentRuntimeLogs", /* GraphQL */ `
query DeploymentRuntimeLogs($deploymentId: String!, $limit: Int) {
  deploymentLogs(deploymentId: $deploymentId, limit: $limit) {
    timestamp
    message
    severity
  }
}`);

export const DeploymentBuildLogs = q("DeploymentBuildLogs", /* GraphQL */ `
query DeploymentBuildLogs($deploymentId: String!, $limit: Int) {
  buildLogs(deploymentId: $deploymentId, limit: $limit) {
    timestamp
    message
    severity
  }
}`);

// ── Mutations (only ever executed from an approved plan, see src/lib/plans.ts) ─

export const DeploymentRemove = m("DeploymentRemove", /* GraphQL */ `
mutation DeploymentRemove($id: String!) {
  deploymentRemove(id: $id)
}`);

export const DeploymentRestart = m("DeploymentRestart", /* GraphQL */ `
mutation DeploymentRestart($id: String!) {
  deploymentRestart(id: $id)
}`);

export const DeploymentRedeploy = m("DeploymentRedeploy", /* GraphQL */ `
mutation DeploymentRedeploy($id: String!) {
  deploymentRedeploy(id: $id) {
    id
    status
  }
}`);

export const DeploymentRollback = m("DeploymentRollback", /* GraphQL */ `
mutation DeploymentRollback($id: String!) {
  deploymentRollback(id: $id)
}`);

export const DeploymentCancel = m("DeploymentCancel", /* GraphQL */ `
mutation DeploymentCancel($id: String!) {
  deploymentCancel(id: $id)
}`);

export const ServiceDelete = m("ServiceDelete", /* GraphQL */ `
mutation ServiceDelete($id: String!, $environmentId: String!) {
  serviceDelete(id: $id, environmentId: $environmentId)
}`);

export const EnvironmentDelete = m("EnvironmentDelete", /* GraphQL */ `
mutation EnvironmentDelete($id: String!) {
  environmentDelete(id: $id)
}`);

export const ProjectScheduleDelete = m("ProjectScheduleDelete", /* GraphQL */ `
mutation ProjectScheduleDelete($id: String!) {
  projectScheduleDelete(id: $id)
}`);

export const ProjectScheduleDeleteCancel = m("ProjectScheduleDeleteCancel", /* GraphQL */ `
mutation ProjectScheduleDeleteCancel($id: String!) {
  projectScheduleDeleteCancel(id: $id)
}`);
