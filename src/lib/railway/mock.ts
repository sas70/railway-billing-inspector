import "server-only";

/**
 * Demo mode (RAILWAY_MOCK=true): an in-memory fake Railway that answers the same
 * GraphQL operations by name. Nothing is sent to Railway. Actions you approve in
 * demo mode change this fake world only, so the whole review → approve → audit
 * flow can be tried safely. Restarting the server resets it.
 */

import { shiftMonths } from "../billing";
import type { GqlDoc } from "./documents";
import { RailwayApiError } from "./errors";
import type * as T from "./types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ── Deterministic helpers ───────────────────────────────────────────────────

function hash32(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function uuid(seed: string): string {
  const hex = [0, 1, 2, 3].map((i) => hash32(`${seed}#${i}`).toString(16).padStart(8, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function rng(seed: string) {
  let a = hash32(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── World model ─────────────────────────────────────────────────────────────

type Rates = { cpu: number; mem: number; egressPerDay: number };
const ZERO_RATES: Rates = { cpu: 0, mem: 0, egressPerDay: 0 };
type Accrued = { cpu: number; mem: number; egress: number };

type MDeployment = {
  id: string;
  status: T.DeploymentStatus;
  createdAt: string;
  updatedAt: string;
  deploymentStopped: boolean;
  meta: Record<string, unknown>;
  creator: { name: string | null; email: string } | null;
  staticUrl: string | null;
  /** In-progress deployments settle to SUCCESS at this time (demo realism). */
  settleAt?: number;
};

type MInstance = {
  id: string;
  serviceId: string;
  environmentId: string;
  createdAt: number;
  numReplicas: number;
  region: string;
  sleepApplication: boolean;
  cronSchedule: string | null;
  startCommand: string | null;
  source: { repo: string | null; image: string | null };
  domains: string[];
  deployments: MDeployment[]; // newest first
  activeIds: string[];
  baseRates: Rates;
  rates: Rates;
  ratesSince: number;
  accrued: Accrued;
  deleted: boolean;
};

type MVolume = {
  id: string;
  volumeId: string;
  name: string;
  serviceId: string;
  environmentId: string;
  mountPath: string;
  sizeMB: number;
  usedMB: number;
  since: number;
  deletedAt: number | null;
};

type MService = { id: string; name: string; icon: string | null; createdAt: string; deletedAt: string | null };
type MEnv = {
  id: string;
  name: string;
  isEphemeral: boolean;
  createdAt: number;
  meta: { prNumber: number | null; prTitle: string | null; branch: string | null } | null;
  deleted: boolean;
};

type MProject = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Hard-deleted before this billing period's end: only shows up in usage. */
  purged: boolean;
  workspaceId: string;
  primaryEnvironmentId: string | null;
  prDeploys: boolean;
  services: MService[];
  envs: MEnv[];
  instances: MInstance[];
  volumes: MVolume[];
  /** Usage of a purged project inside the current period. */
  fixedUsage?: Accrued & { serviceId: string };
};

type MWorkspace = {
  id: string;
  name: string;
  plan: T.Plan;
  periodStart: number;
  periodEnd: number;
  creditBalance: number;
  softLimit: number;
  hardLimit: number | null;
};

type World = { createdAt: number; workspaces: MWorkspace[]; projects: MProject[]; counter: number };

// ── World spec (generic demo names) ─────────────────────────────────────────

type SvcSpec = {
  name: string;
  repo?: string;
  image?: string;
  history: T.DeploymentStatus[];
  rates?: Partial<Rates>;
  /** For services that are not running now: share of the elapsed period they ran for. */
  ranFraction?: number;
  volume?: { name: string; mount: string; sizeMB: number; usedMB: number };
  domain?: string;
  sleep?: boolean;
  cron?: string;
  replicas?: number;
};
type EnvSpec = {
  name: string;
  ephemeral?: boolean;
  ageDays?: number;
  meta?: { prNumber: number; prTitle: string; branch: string };
  services: SvcSpec[];
};
type ProjSpec = { ws: "personal" | "studio"; name: string; description?: string; prDeploys?: boolean; ageDays: number; envs: EnvSpec[] };

const PG_IMAGE = "ghcr.io/railwayapp-templates/postgres-ssl:17";

const SPEC: ProjSpec[] = [
  {
    ws: "personal",
    name: "acme-api",
    description: "Customer-facing REST API",
    prDeploys: true,
    ageDays: 410,
    envs: [
      {
        name: "production",
        services: [
          { name: "api", repo: "acme/api", history: ["SUCCESS", "REMOVED", "REMOVED", "FAILED", "REMOVED", "REMOVED", "REMOVED", "REMOVED", "REMOVED"], rates: { cpu: 0.02, mem: 0.16, egressPerDay: 0.08 }, domain: "api.acme.dev" },
          { name: "worker", repo: "acme/api", history: ["CRASHED", "REMOVED", "REMOVED"], rates: { cpu: 0.01, mem: 0.09 }, ranFraction: 0.7 },
          { name: "Postgres", image: PG_IMAGE, history: ["SUCCESS", "REMOVED"], rates: { cpu: 0.006, mem: 0.08, egressPerDay: 0.002 }, volume: { name: "postgres-volume", mount: "/var/lib/postgresql/data", sizeMB: 5000, usedMB: 640 } },
          { name: "Redis", image: "redis:7.4", history: ["SUCCESS"], rates: { cpu: 0.002, mem: 0.015 } },
        ],
      },
      {
        name: "staging",
        services: [
          { name: "api", repo: "acme/api", history: ["SUCCESS", "REMOVED", "REMOVED"], rates: { cpu: 0.004, mem: 0.1, egressPerDay: 0.005 } },
          { name: "Postgres", image: PG_IMAGE, history: ["SUCCESS"], rates: { cpu: 0.003, mem: 0.06 }, volume: { name: "postgres-volume-staging", mount: "/var/lib/postgresql/data", sizeMB: 5000, usedMB: 120 } },
        ],
      },
      {
        name: "pr-42",
        ephemeral: true,
        ageDays: 6,
        meta: { prNumber: 42, prTitle: "Add CSV invoice export", branch: "feat/csv-export" },
        services: [{ name: "api", repo: "acme/api", history: ["SUCCESS", "REMOVED"], rates: { cpu: 0.004, mem: 0.1 } }],
      },
    ],
  },
  {
    ws: "personal",
    name: "marketing-site",
    description: "Public website",
    ageDays: 300,
    envs: [{ name: "production", services: [{ name: "web", repo: "acme/site", history: ["SUCCESS", "FAILED", "REMOVED", "REMOVED"], rates: { cpu: 0.002, mem: 0.05, egressPerDay: 0.15 }, domain: "www.acme.dev" }] }],
  },
  {
    ws: "personal",
    name: "socket-relay",
    ageDays: 120,
    envs: [{ name: "production", services: [{ name: "relay", repo: "acme/relay", history: ["SLEEPING", "REMOVED"], sleep: true, rates: { cpu: 0.0003, mem: 0.004 } }] }],
  },
  {
    ws: "personal",
    name: "old-experiments",
    description: "Notebook sandbox",
    ageDays: 520,
    envs: [{ name: "production", services: [{ name: "notebook", image: "jupyter/base-notebook", history: ["FAILED", "REMOVED"], rates: {}, volume: { name: "notebook-data", mount: "/home/jovyan/work", sizeMB: 5000, usedMB: 3100 } }] }],
  },
  {
    ws: "studio",
    name: "client-portal",
    description: "Client portal (web + API)",
    ageDays: 240,
    envs: [
      {
        name: "production",
        services: [
          { name: "web", repo: "studio/portal-web", history: ["FAILED", "SUCCESS", "REMOVED", "REMOVED", "REMOVED"], rates: { cpu: 0.05, mem: 0.55, egressPerDay: 1.1 }, domain: "portal.example.com", replicas: 2 },
          { name: "api", repo: "studio/portal-api", history: ["SUCCESS", "REMOVED", "REMOVED", "REMOVED"], rates: { cpu: 0.12, mem: 0.9, egressPerDay: 0.6 }, replicas: 2 },
          { name: "Postgres", image: PG_IMAGE, history: ["SUCCESS"], rates: { cpu: 0.03, mem: 0.4 }, volume: { name: "portal-db", mount: "/var/lib/postgresql/data", sizeMB: 20000, usedMB: 7400 } },
        ],
      },
      {
        name: "staging",
        services: [
          { name: "web", repo: "studio/portal-web", history: ["SUCCESS", "REMOVED"], rates: { cpu: 0.01, mem: 0.3, egressPerDay: 0.01 } },
          { name: "api", repo: "studio/portal-api", history: ["SUCCESS"], rates: { cpu: 0.02, mem: 0.45 } },
        ],
      },
    ],
  },
  {
    ws: "studio",
    name: "data-pipeline",
    description: "Ingestion + nightly reports",
    ageDays: 150,
    envs: [
      {
        name: "production",
        services: [
          { name: "ingest-worker", repo: "studio/pipeline", history: ["BUILDING", "SUCCESS", "REMOVED", "REMOVED"], rates: { cpu: 0.6, mem: 1.8, egressPerDay: 0.3 } },
          { name: "nightly-report", repo: "studio/pipeline", cron: "0 3 * * *", history: ["SUCCESS", "REMOVED", "REMOVED"], rates: { cpu: 0.002, mem: 0.05 } },
        ],
      },
    ],
  },
  {
    ws: "studio",
    name: "legacy-dashboard",
    ageDays: 700,
    envs: [
      { name: "production", services: [{ name: "app", repo: "studio/legacy-dash", history: ["SUCCESS", "REMOVED"], rates: { cpu: 0.01, mem: 0.35, egressPerDay: 0.05 } }] },
      { name: "staging", services: [{ name: "app", repo: "studio/legacy-dash", history: ["FAILED", "FAILED", "REMOVED"], rates: {} }] },
    ],
  },
];

const COMMITS = [
  "Fix timezone handling in invoices",
  "Bump dependencies",
  "Add health check endpoint",
  "Refactor auth middleware",
  "Cache exchange rates for 1h",
  "Improve error logging",
  "Tune connection pool size",
  "Add pagination to /orders",
  "Update Dockerfile base image",
  "Handle webhook retries",
];

function buildWorld(): World {
  const now = Date.now();
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);
  const periodStart = startOfToday.getTime() - 19 * DAY;
  const periodEnd = Date.parse(shiftMonths(new Date(periodStart).toISOString(), 1));

  const workspaces: MWorkspace[] = [
    { id: uuid("ws-personal"), name: "Personal", plan: "HOBBY", periodStart, periodEnd, creditBalance: 0, softLimit: 10, hardLimit: 25 },
    { id: uuid("ws-studio"), name: "Studio", plan: "PRO", periodStart: periodStart + 4 * DAY, periodEnd: Date.parse(shiftMonths(new Date(periodStart + 4 * DAY).toISOString(), 1)), creditBalance: 12.5, softLimit: 100, hardLimit: null },
  ];
  const wsByKey = { personal: workspaces[0], studio: workspaces[1] };

  const projects: MProject[] = SPEC.map((spec) => {
    const ws = wsByKey[spec.ws];
    const projectId = uuid(`project-${spec.name}`);
    const random = rng(spec.name);
    const services = new Map<string, MService>();
    const envs: MEnv[] = [];
    const instances: MInstance[] = [];
    const volumes: MVolume[] = [];

    for (const envSpec of spec.envs) {
      const envCreated = now - (envSpec.ageDays ?? spec.ageDays) * DAY;
      const env: MEnv = {
        id: uuid(`env-${spec.name}-${envSpec.name}`),
        name: envSpec.name,
        isEphemeral: !!envSpec.ephemeral,
        createdAt: envCreated,
        meta: envSpec.meta ?? null,
        deleted: false,
      };
      envs.push(env);

      for (const svc of envSpec.services) {
        let service = services.get(svc.name);
        if (!service) {
          service = {
            id: uuid(`svc-${spec.name}-${svc.name}`),
            name: svc.name,
            icon: svc.image?.includes("postgres") ? "postgres" : svc.image?.includes("redis") ? "redis" : null,
            createdAt: new Date(now - spec.ageDays * DAY).toISOString(),
            deletedAt: null,
          };
          services.set(svc.name, service);
        }

        const baseRates: Rates = { ...ZERO_RATES, ...svc.rates };
        const instanceSeed = `${spec.name}/${envSpec.name}/${svc.name}`;
        const r = rng(instanceSeed);
        // Deployment history, newest first
        let cursor = now - (2 + r() * 30) * HOUR;
        const deployments: MDeployment[] = svc.history.map((status, index) => {
          const createdAt = cursor;
          cursor -= (0.6 + r() * 3.5) * DAY;
          if (cursor < envCreated) cursor = envCreated + (svc.history.length - index) * HOUR;
          const commit = COMMITS[Math.floor(r() * COMMITS.length)];
          const meta: Record<string, unknown> = svc.image
            ? { image: svc.image, reason: index === 0 ? "deploy" : "redeploy" }
            : {
                repo: svc.repo,
                branch: envSpec.meta?.branch ?? "main",
                commitHash: hash32(`${instanceSeed}-${index}`).toString(16).padStart(8, "0") + "c0ffee",
                commitMessage: commit,
                commitAuthor: "demo-dev",
                reason: "deploy",
              };
          const d: MDeployment = {
            id: uuid(`dep-${instanceSeed}-${index}`),
            status,
            createdAt: new Date(createdAt).toISOString(),
            updatedAt: new Date(createdAt + 3 * MINUTE).toISOString(),
            deploymentStopped: status === "REMOVED" || status === "FAILED",
            meta,
            creator: svc.image ? null : { name: "Demo Developer", email: "dev@example.com" },
            staticUrl: status === "SUCCESS" ? `${svc.name}-${envSpec.name}-${hash32(instanceSeed).toString(36).slice(0, 4)}.up.railway.app` : null,
          };
          if (status === "BUILDING") d.settleAt = now + 45_000;
          return d;
        });

        const active = deployments.find((d) => d.status === "SUCCESS" || d.status === "SLEEPING");
        const running = !!active;
        const since = Math.max(ws.periodStart, envCreated);
        const elapsedMin = Math.max(0, (now - since) / MINUTE);
        const accrued: Accrued = { cpu: 0, mem: 0, egress: 0 };
        if (!running && svc.ranFraction) {
          const ran = elapsedMin * svc.ranFraction;
          accrued.cpu = baseRates.cpu * ran;
          accrued.mem = baseRates.mem * ran;
          accrued.egress = (baseRates.egressPerDay / 1440) * ran;
        }

        instances.push({
          id: uuid(`si-${instanceSeed}`),
          serviceId: service.id,
          environmentId: env.id,
          createdAt: envCreated,
          numReplicas: svc.replicas ?? 1,
          region: spec.ws === "studio" ? "us-east4-eqdc4a" : "us-west2",
          sleepApplication: !!svc.sleep,
          cronSchedule: svc.cron ?? null,
          startCommand: null,
          source: { repo: svc.repo ?? null, image: svc.image ?? null },
          domains: svc.domain && envSpec.name === "production" ? [svc.domain] : [],
          deployments,
          activeIds: active ? [active.id] : [],
          baseRates,
          rates: running ? baseRates : ZERO_RATES,
          ratesSince: since,
          accrued,
          deleted: false,
        });

        if (svc.volume) {
          volumes.push({
            id: uuid(`vi-${instanceSeed}`),
            volumeId: uuid(`vol-${instanceSeed}`),
            name: svc.volume.name,
            serviceId: service.id,
            environmentId: env.id,
            mountPath: svc.volume.mount,
            sizeMB: svc.volume.sizeMB,
            usedMB: svc.volume.usedMB,
            since,
            deletedAt: null,
          });
        }
      }
    }

    const created = now - spec.ageDays * DAY;
    return {
      id: projectId,
      name: spec.name,
      description: spec.description ?? null,
      createdAt: new Date(created).toISOString(),
      updatedAt: new Date(now - random() * 5 * DAY).toISOString(),
      deletedAt: null,
      purged: false,
      workspaceId: ws.id,
      primaryEnvironmentId: envs.find((e) => !e.isEphemeral)?.id ?? null,
      prDeploys: !!spec.prDeploys,
      services: [...services.values()],
      envs,
      instances,
      volumes,
    };
  });

  // A project deleted earlier this period: it still shows up in the period's usage.
  projects.push({
    id: uuid("project-prototype-v1"),
    name: "prototype-v1",
    description: null,
    createdAt: new Date(now - 90 * DAY).toISOString(),
    updatedAt: new Date(now - 12 * DAY).toISOString(),
    deletedAt: new Date(now - 12 * DAY).toISOString(),
    purged: true,
    workspaceId: workspaces[0].id,
    primaryEnvironmentId: null,
    prDeploys: false,
    services: [{ id: uuid("svc-prototype-web"), name: "web", icon: null, createdAt: new Date(now - 90 * DAY).toISOString(), deletedAt: new Date(now - 12 * DAY).toISOString() }],
    envs: [],
    instances: [],
    volumes: [],
    fixedUsage: { serviceId: uuid("svc-prototype-web"), cpu: 0.01 * 7 * 1440, mem: 0.2 * 7 * 1440, egress: 0.4 },
  });

  return { createdAt: now, workspaces, projects, counter: 0 };
}

const globalStore = globalThis as typeof globalThis & { __rbiMockWorld?: World };

function world(): World {
  globalStore.__rbiMockWorld ??= buildWorld();
  settle(globalStore.__rbiMockWorld);
  return globalStore.__rbiMockWorld;
}

// ── Accounting helpers ──────────────────────────────────────────────────────

function accruedAt(instance: MInstance, at: number): Accrued {
  const minutes = Math.max(0, (at - instance.ratesSince) / MINUTE);
  return {
    cpu: instance.accrued.cpu + instance.rates.cpu * minutes,
    mem: instance.accrued.mem + instance.rates.mem * minutes,
    egress: instance.accrued.egress + (instance.rates.egressPerDay / 1440) * minutes,
  };
}

function setRates(instance: MInstance, rates: Rates, at = Date.now()) {
  instance.accrued = accruedAt(instance, at);
  instance.ratesSince = at;
  instance.rates = rates;
}

function volumeGbMinutes(volume: MVolume, at: number): number {
  const end = Math.min(at, volume.deletedAt ?? at);
  return (volume.usedMB / 1024) * Math.max(0, (end - volume.since) / MINUTE);
}

/** Let demo builds finish: in-progress deployments turn live after a short delay. */
function settle(w: World) {
  const now = Date.now();
  for (const project of w.projects) {
    for (const instance of project.instances) {
      for (const d of instance.deployments) {
        if (d.settleAt && d.settleAt <= now && (d.status === "BUILDING" || d.status === "DEPLOYING" || d.status === "QUEUED")) {
          delete d.settleAt;
          d.status = "SUCCESS";
          d.deploymentStopped = false;
          d.updatedAt = new Date(now).toISOString();
          for (const other of instance.deployments) {
            if (other !== d && instance.activeIds.includes(other.id)) {
              other.status = "REMOVED";
              other.deploymentStopped = true;
            }
          }
          instance.activeIds = [d.id];
          if (!instance.deleted) setRates(instance, instance.baseRates, now);
        }
      }
    }
  }
}

// ── Lookups ─────────────────────────────────────────────────────────────────

const notFound = (what: string, op: string) => new RailwayApiError(`${what} not found (${op})`, { kind: "not_found", operation: op });
const refuse = (message: string, op: string) => new RailwayApiError(`${message} (${op})`, { kind: "graphql", operation: op });

function findWorkspace(w: World, id: unknown, op: string) {
  const ws = w.workspaces.find((x) => x.id === id);
  if (!ws) throw notFound("Workspace", op);
  return ws;
}

function findProject(w: World, id: unknown, op: string) {
  const project = w.projects.find((p) => p.id === id && !p.purged);
  if (!project) throw notFound("Project", op);
  return project;
}

function findDeployment(w: World, id: unknown, op: string) {
  for (const project of w.projects) {
    for (const instance of project.instances) {
      if (instance.deleted) continue;
      const deployment = instance.deployments.find((d) => d.id === id);
      if (deployment) return { project, instance, deployment };
    }
  }
  throw notFound("Deployment", op);
}

const serviceName = (project: MProject, serviceId: string) => project.services.find((s) => s.id === serviceId)?.name ?? "service";

// ── Shapers ─────────────────────────────────────────────────────────────────

const edges = <X>(nodes: X[]) => ({ edges: nodes.map((node) => ({ node })) });
const iso = (ms: number) => new Date(ms).toISOString();

function liveInstances(project: MProject, envId?: string) {
  return project.instances.filter((i) => !i.deleted && (!envId || i.environmentId === envId));
}

function lite(d: MDeployment) {
  return { id: d.id, status: d.status, createdAt: d.createdAt, deploymentStopped: d.deploymentStopped, meta: d.meta };
}

function instanceDetail(project: MProject, instance: MInstance): T.InstanceDetail & { restartPolicyType: string; startCommand: string | null } {
  const latest = instance.deployments[0] ?? null;
  return {
    id: instance.id,
    serviceId: instance.serviceId,
    serviceName: serviceName(project, instance.serviceId),
    environmentId: instance.environmentId,
    numReplicas: instance.numReplicas,
    region: instance.region,
    sleepApplication: instance.sleepApplication,
    cronSchedule: instance.cronSchedule,
    nextCronRunAt: instance.cronSchedule ? iso(Date.now() + 7 * HOUR) : null,
    restartPolicyType: "ON_FAILURE",
    startCommand: instance.startCommand,
    source: instance.source,
    latestDeployment: latest ? lite(latest) : null,
    activeDeployments: instance.deployments.filter((d) => instance.activeIds.includes(d.id)).map(lite),
    domains: {
      serviceDomains: instance.deployments.some((d) => d.staticUrl)
        ? [{ domain: instance.deployments.find((d) => d.staticUrl)!.staticUrl! }]
        : [],
      customDomains: instance.domains.map((domain) => ({ domain })),
    },
  };
}

function deploymentNode(d: MDeployment): T.DeploymentNode {
  const age = Date.now() - Date.parse(d.createdAt);
  return {
    id: d.id,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    statusUpdatedAt: d.updatedAt,
    staticUrl: d.staticUrl,
    canRedeploy: !["BUILDING", "DEPLOYING", "QUEUED", "INITIALIZING", "WAITING"].includes(d.status),
    canRollback: d.status === "REMOVED" && age < 5 * DAY && !d.meta.image,
    deploymentStopped: d.deploymentStopped,
    meta: d.meta,
    creator: d.creator,
  };
}

// ── Usage ───────────────────────────────────────────────────────────────────

type Row = T.UsageRow;

function usageRows(w: World, ws: MWorkspace, measurements: string[], groupBy: string[], from: number, to: number): Row[] {
  const now = Date.now();
  const isCurrent = Math.abs(from - ws.periodStart) < HOUR;
  const withEnv = groupBy.includes("ENVIRONMENT_ID");
  const rows = new Map<string, Row>();

  const add = (projectId: string, serviceId: string | null, environmentId: string | null, measurement: string, value: number) => {
    if (!measurements.includes(measurement) || !(value > 0)) return;
    const envKey = withEnv ? environmentId : null;
    const key = `${projectId}|${serviceId}|${envKey}|${measurement}`;
    const existing = rows.get(key);
    if (existing) existing.value += value;
    else rows.set(key, { measurement, value, tags: { projectId, serviceId, environmentId: envKey } });
  };

  for (const project of w.projects.filter((p) => p.workspaceId === ws.id)) {
    if (isCurrent) {
      for (const instance of project.instances) {
        const a = accruedAt(instance, Math.min(now, to));
        add(project.id, instance.serviceId, instance.environmentId, "CPU_USAGE", a.cpu);
        add(project.id, instance.serviceId, instance.environmentId, "MEMORY_USAGE_GB", a.mem);
        add(project.id, instance.serviceId, instance.environmentId, "NETWORK_TX_GB", a.egress);
      }
      for (const volume of project.volumes) {
        add(project.id, volume.serviceId, volume.environmentId, "DISK_USAGE_GB", volumeGbMinutes(volume, Math.min(now, to)));
      }
      if (project.fixedUsage) {
        const f = project.fixedUsage;
        add(project.id, f.serviceId, null, "CPU_USAGE", f.cpu);
        add(project.id, f.serviceId, null, "MEMORY_USAGE_GB", f.mem);
        add(project.id, f.serviceId, null, "NETWORK_TX_GB", f.egress);
      }
    } else {
      // Previous period: steady-state usage with some month-to-month variation.
      const minutes = (to - from) / MINUTE;
      const random = rng(`${project.id}-${from}`);
      for (const instance of project.instances) {
        if (instance.createdAt > from) continue;
        const factor = 0.8 + random() * 0.3;
        const b = instance.baseRates;
        add(project.id, instance.serviceId, instance.environmentId, "CPU_USAGE", b.cpu * minutes * factor);
        add(project.id, instance.serviceId, instance.environmentId, "MEMORY_USAGE_GB", b.mem * minutes * factor);
        add(project.id, instance.serviceId, instance.environmentId, "NETWORK_TX_GB", (b.egressPerDay / 1440) * minutes * factor);
      }
      for (const volume of project.volumes) {
        add(project.id, volume.serviceId, volume.environmentId, "DISK_USAGE_GB", (volume.usedMB / 1024) * 0.9 * minutes);
      }
      if (project.fixedUsage) {
        const f = project.fixedUsage;
        add(project.id, f.serviceId, null, "CPU_USAGE", f.cpu * 3);
        add(project.id, f.serviceId, null, "MEMORY_USAGE_GB", f.mem * 3);
        add(project.id, f.serviceId, null, "NETWORK_TX_GB", f.egress * 3);
      }
    }
  }
  return [...rows.values()];
}

function estimatedRows(w: World, ws: MWorkspace, measurements: string[]): T.EstimatedRow[] {
  const out: T.EstimatedRow[] = [];
  for (const project of w.projects.filter((p) => p.workspaceId === ws.id)) {
    const totals = { CPU_USAGE: 0, MEMORY_USAGE_GB: 0, NETWORK_TX_GB: 0, DISK_USAGE_GB: 0, BACKUP_USAGE_GB: 0 };
    for (const instance of project.instances) {
      const a = accruedAt(instance, ws.periodEnd);
      totals.CPU_USAGE += a.cpu;
      totals.MEMORY_USAGE_GB += a.mem;
      totals.NETWORK_TX_GB += a.egress;
    }
    for (const volume of project.volumes) totals.DISK_USAGE_GB += volumeGbMinutes(volume, ws.periodEnd);
    if (project.fixedUsage) {
      totals.CPU_USAGE += project.fixedUsage.cpu;
      totals.MEMORY_USAGE_GB += project.fixedUsage.mem;
      totals.NETWORK_TX_GB += project.fixedUsage.egress;
    }
    for (const [measurement, estimatedValue] of Object.entries(totals)) {
      if (measurements.includes(measurement) && estimatedValue > 0) out.push({ measurement, estimatedValue, projectId: project.id });
    }
  }
  return out;
}

function meteredDollars(rows: Row[]): number {
  const price: Record<string, number> = {
    CPU_USAGE: 20 / 43_200,
    MEMORY_USAGE_GB: 10 / 43_200,
    NETWORK_TX_GB: 0.05,
    DISK_USAGE_GB: 0.15 / 43_200,
    BACKUP_USAGE_GB: 0.15 / 43_200,
  };
  return rows.reduce((sum, row) => sum + row.value * (price[row.measurement] ?? 0), 0);
}

// ── Metrics & logs ──────────────────────────────────────────────────────────

function metricSeries(instance: MInstance, plan: T.Plan, measurements: string[], start: number, end: number, step: number) {
  const random = rng(`${instance.id}-${Math.floor(start / HOUR)}`);
  const running = instance.activeIds.length > 0 && !instance.deleted;
  const b = instance.rates.cpu > 0 ? instance.rates : instance.baseRates;
  const out: { measurement: string; values: { ts: number; value: number }[] }[] = [];
  const phase = (hash32(instance.id) % 1000) / 1000;
  for (const measurement of measurements) {
    const values: { ts: number; value: number }[] = [];
    if (running) {
      for (let t = start; t <= end; t += step * 1000) {
        const day = Math.sin(((t / DAY + phase) % 1) * 2 * Math.PI);
        const noise = random() - 0.5;
        let value = 0;
        switch (measurement) {
          case "CPU_USAGE":
            value = Math.max(0, b.cpu * (1 + 0.45 * day + 0.5 * noise));
            break;
          case "MEMORY_USAGE_GB":
            value = Math.max(0.001, b.mem * (1 + 0.04 * day + 0.04 * noise));
            break;
          case "NETWORK_TX_GB":
            value = Math.max(0, (b.egressPerDay * step) / 86_400) * (1 + 0.7 * day + 0.6 * noise);
            break;
          case "NETWORK_RX_GB":
            value = Math.max(0, (b.egressPerDay * 0.4 * step) / 86_400) * (1 + 0.5 * day + 0.6 * noise);
            break;
          case "CPU_LIMIT":
            value = plan === "PRO" ? 32 : 8;
            break;
          case "MEMORY_LIMIT_GB":
            value = plan === "PRO" ? 32 : 8;
            break;
        }
        values.push({ ts: Math.floor(t / 1000), value });
      }
    }
    out.push({ measurement, values });
  }
  return out;
}

function logLines(deployment: MDeployment, kind: "runtime" | "build", limit: number): T.LogLine[] {
  const random = rng(`${deployment.id}-${kind}`);
  const base = Date.parse(deployment.createdAt);
  const lines: T.LogLine[] = [];
  const push = (offsetMs: number, message: string, severity: string | null = "info") =>
    lines.push({ timestamp: new Date(base + offsetMs).toISOString(), message, severity });

  if (kind === "build") {
    push(0, "[Region: us-west2] Using Railpack");
    push(1500, "  ↳ Detected Node 22 (from package.json engines)");
    push(4000, "[internal] load build definition from Dockerfile");
    push(9000, "RUN npm ci");
    push(38_000, "added 412 packages in 27s");
    push(41_000, "RUN npm run build");
    if (deployment.status === "FAILED") {
      push(52_000, "Error: Cannot find module './config/production.json'", "error");
      push(52_500, "Build failed with exit code 1", "error");
    } else {
      push(64_000, "✓ Compiled successfully");
      push(70_000, `Build time: ${(58 + random() * 20).toFixed(1)} seconds`);
    }
    return lines.slice(-limit);
  }

  push(80_000, "Starting Container");
  push(82_000, "> node server.js");
  push(83_500, "Listening on 0.0.0.0:8080");
  const count = deployment.status === "SUCCESS" || deployment.status === "SLEEPING" ? 60 : 12;
  for (let i = 0; i < count; i++) {
    const path = ["/health", "/api/orders", "/api/invoices", "/api/customers"][Math.floor(random() * 4)];
    const ms = Math.round(4 + random() * 180);
    push(90_000 + i * 45_000, `GET ${path} 200 ${ms}ms`);
  }
  if (deployment.status === "CRASHED") {
    push(95_000 + count * 45_000, "Error: connect ECONNREFUSED 10.0.4.12:6379", "error");
    push(95_500 + count * 45_000, "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)", "error");
    push(96_000 + count * 45_000, "Process exited with code 1", "error");
  }
  return lines.slice(-limit);
}

// ── Operation handlers ─────────────────────────────────────────────────────

type Vars = Record<string, unknown>;
type Handler = (w: World, v: Vars, op: string) => unknown;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function projectNode(project: MProject): T.ProjectNode {
  const liveEnvs = project.envs.filter((e) => !e.deleted);
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    deletedAt: project.deletedAt,
    workspaceId: project.workspaceId,
    primaryEnvironmentId: project.primaryEnvironmentId,
    prDeploys: project.prDeploys,
    services: edges(project.services.filter((s) => !s.deletedAt).map((s) => ({ id: s.id, name: s.name, icon: s.icon }))),
    environments: edges(
      liveEnvs.map((env) => ({
        id: env.id,
        name: env.name,
        isEphemeral: env.isEphemeral,
        serviceInstances: edges(
          liveInstances(project, env.id).map((i) => {
            const latest = i.deployments[0];
            return {
              id: i.id,
              serviceId: i.serviceId,
              serviceName: serviceName(project, i.serviceId),
              environmentId: i.environmentId,
              latestDeployment: latest ? { id: latest.id, status: latest.status, createdAt: latest.createdAt } : null,
              activeDeployments: i.deployments
                .filter((d) => i.activeIds.includes(d.id))
                .map((d) => ({ id: d.id, status: d.status, deploymentStopped: d.deploymentStopped })),
            };
          }),
        ),
      })),
    ),
  };
}

function newDeploymentFrom(w: World, instance: MInstance, source: MDeployment, reason: string): MDeployment {
  w.counter++;
  const now = Date.now();
  return {
    id: uuid(`dep-new-${source.id}-${w.counter}-${now}`),
    status: "BUILDING",
    createdAt: iso(now),
    updatedAt: iso(now),
    deploymentStopped: false,
    meta: { ...source.meta, reason },
    creator: { name: "Demo User", email: "demo@example.com" },
    staticUrl: source.staticUrl ?? instance.deployments.find((d) => d.staticUrl)?.staticUrl ?? null,
    settleAt: now + 25_000,
  };
}

const HANDLERS: Record<string, Handler> = {
  Me: (w) => ({
    me: {
      id: uuid("user-demo"),
      name: "Demo User",
      email: "demo@example.com",
      workspaces: w.workspaces.map((ws) => ({ id: ws.id, name: ws.name, plan: ws.plan })),
    },
  }),

  WorkspaceInfo: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    return { workspace: { id: ws.id, name: ws.name, plan: ws.plan } };
  },

  TokenWorkspaceProbe: (w) => ({
    projects: edges(
      w.projects
        .filter((p) => !p.purged)
        .slice(0, 25)
        .map((p) => {
          const ws = w.workspaces.find((x) => x.id === p.workspaceId)!;
          return { id: p.id, workspace: { id: ws.id, name: ws.name, plan: ws.plan } };
        }),
    ),
  }),

  WorkspaceBilling: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    const rows = usageRows(w, ws, ["CPU_USAGE", "MEMORY_USAGE_GB", "NETWORK_TX_GB", "DISK_USAGE_GB", "BACKUP_USAGE_GB"], ["PROJECT_ID"], ws.periodStart, ws.periodEnd);
    const usage = Math.round(meteredDollars(rows) * 100) / 100;
    const fee = ws.plan === "PRO" ? 20 : ws.plan === "HOBBY" ? 5 : 0;
    const included = ws.plan === "PRO" ? 20 : ws.plan === "HOBBY" ? 5 : 1;
    return {
      workspace: {
        id: ws.id,
        name: ws.name,
        plan: ws.plan,
        customer: {
          id: uuid(`cus-${ws.id}`),
          state: "ACTIVE",
          isTrialing: false,
          trialDaysRemaining: 0,
          currentUsage: usage,
          creditBalance: ws.creditBalance,
          appliedCredits: 0,
          remainingUsageCreditBalance: Math.max(0, included - usage),
          billingPeriod: { start: iso(ws.periodStart), end: iso(ws.periodEnd) },
          usageLimit: { softLimit: ws.softLimit, hardLimit: ws.hardLimit, isOverLimit: false },
          subscriptions: [
            {
              id: `sub_demo_${ws.plan.toLowerCase()}`,
              status: "active",
              billingCycleAnchor: iso(ws.periodStart),
              nextInvoiceDate: iso(ws.periodEnd),
              nextInvoiceCurrentTotal: Math.round((fee + Math.max(0, usage - included)) * 100),
              cancelAtPeriodEnd: false,
            },
          ],
        },
      },
    };
  },

  WorkspaceInvoices: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    const random = rng(`invoices-${ws.id}`);
    const invoices: T.Invoice[] = [1, 2, 3].map((back) => {
      const start = Date.parse(shiftMonths(iso(ws.periodStart), -back));
      const end = Date.parse(shiftMonths(iso(ws.periodStart), -back + 1));
      const fee = ws.plan === "PRO" ? 20 : 5;
      const overage = ws.plan === "PRO" ? 20 + random() * 30 : random() < 0.5 ? 0 : random() * 3;
      const cents = Math.round((fee + overage) * 100);
      return {
        invoiceId: `in_demo_${ws.plan.toLowerCase()}_${back}`,
        periodStart: iso(start),
        periodEnd: iso(end),
        total: cents,
        amountDue: cents,
        amountPaid: cents,
        status: "paid",
        hostedURL: null,
        pdfURL: null,
      };
    });
    return { workspace: { id: ws.id, customer: { id: uuid(`cus-${ws.id}`), invoices } } };
  },

  WorkspaceProjects: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    const all = w.projects.filter((p) => p.workspaceId === ws.id && !p.purged);
    const offset = v.after ? Number(v.after) : 0;
    const page = all.slice(offset, offset + 50);
    return {
      projects: {
        pageInfo: { hasNextPage: offset + 50 < all.length, endCursor: String(offset + page.length) },
        ...edges(page.map(projectNode)),
      },
    };
  },

  ProjectDetail: (w, v, op) => {
    const project = findProject(w, v.id, op);
    const ws = w.workspaces.find((x) => x.id === project.workspaceId)!;
    return {
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        deletedAt: project.deletedAt,
        workspaceId: project.workspaceId,
        primaryEnvironmentId: project.primaryEnvironmentId,
        prDeploys: project.prDeploys,
        workspace: { id: ws.id, name: ws.name, plan: ws.plan },
        services: edges(project.services.filter((s) => !s.deletedAt).map((s) => ({ id: s.id, name: s.name, icon: s.icon, createdAt: s.createdAt }))),
        environments: edges(
          project.envs
            .filter((e) => !e.deleted)
            .map((e) => ({
              id: e.id,
              name: e.name,
              isEphemeral: e.isEphemeral,
              createdAt: iso(e.createdAt),
              meta: e.meta,
              serviceInstances: edges(liveInstances(project, e.id).map((i) => ({ serviceId: i.serviceId }))),
            })),
        ),
      },
    };
  },

  EnvironmentDetail: (w, v, op) => {
    const project = findProject(w, v.projectId, op);
    const env = project.envs.find((e) => e.id === v.environmentId && !e.deleted);
    if (!env) throw notFound("Environment", op);
    return {
      environment: {
        id: env.id,
        name: env.name,
        isEphemeral: env.isEphemeral,
        serviceInstances: edges(liveInstances(project, env.id).map((i) => instanceDetail(project, i))),
        volumeInstances: edges(
          project.volumes
            .filter((vol) => vol.environmentId === env.id && !vol.deletedAt)
            .map((vol) => ({
              id: vol.id,
              serviceId: vol.serviceId,
              mountPath: vol.mountPath,
              currentSizeMB: vol.usedMB,
              sizeMB: vol.sizeMB,
              state: "READY",
              isPendingDeletion: false,
              volume: { id: vol.volumeId, name: vol.name },
            })),
        ),
      },
    };
  },

  ServiceInstanceDetail: (w, v, op) => {
    for (const project of w.projects) {
      const instance = liveInstances(project).find((i) => i.serviceId === v.serviceId && i.environmentId === v.environmentId);
      if (instance) return { serviceInstance: instanceDetail(project, instance) };
    }
    throw notFound("ServiceInstance", op);
  },

  ServiceDeployments: (w, v) => {
    const input = (v.input ?? {}) as { projectId?: string; serviceId?: string; environmentId?: string; status?: { in?: string[]; notIn?: string[] } };
    const project = w.projects.find((p) => p.id === input.projectId && !p.purged);
    const instance = project ? liveInstances(project).find((i) => i.serviceId === input.serviceId && i.environmentId === input.environmentId) : undefined;
    let list = instance?.deployments ?? [];
    if (input.status?.in) list = list.filter((d) => input.status!.in!.includes(d.status));
    if (input.status?.notIn) list = list.filter((d) => !input.status!.notIn!.includes(d.status));
    const first = typeof v.first === "number" ? v.first : 50;
    const offset = v.after ? Number(v.after) : 0;
    const page = list.slice(offset, offset + first);
    return {
      deployments: {
        pageInfo: { hasNextPage: offset + first < list.length, endCursor: String(offset + page.length) },
        ...edges(page.map(deploymentNode)),
      },
    };
  },

  DeploymentForReview: (w, v, op) => {
    const { project, instance, deployment } = findDeployment(w, v.id, op);
    const env = project.envs.find((e) => e.id === instance.environmentId)!;
    const node = deploymentNode(deployment);
    return {
      deployment: {
        id: deployment.id,
        status: deployment.status,
        createdAt: deployment.createdAt,
        projectId: project.id,
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
        canRedeploy: node.canRedeploy,
        canRollback: node.canRollback,
        deploymentStopped: deployment.deploymentStopped,
        meta: deployment.meta,
        service: { id: instance.serviceId, name: serviceName(project, instance.serviceId) },
        environment: { id: env.id, name: env.name },
      },
    };
  },

  WorkspaceUsage: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    const from = v.startDate ? Date.parse(str(v.startDate)) : ws.periodStart;
    const to = v.endDate ? Date.parse(str(v.endDate)) : ws.periodEnd;
    return {
      usage: usageRows(w, ws, strList(v.measurements), strList(v.groupBy), from, to),
      projects: edges(
        w.projects
          .filter((p) => p.workspaceId === ws.id)
          .map((p) => ({
            id: p.id,
            name: p.name,
            deletedAt: p.deletedAt,
            services: edges(p.services.map((s) => ({ id: s.id, name: s.name, deletedAt: s.deletedAt }))),
          })),
      ),
    };
  },

  WorkspaceEstimatedUsage: (w, v, op) => {
    const ws = findWorkspace(w, v.workspaceId, op);
    return { estimatedUsage: estimatedRows(w, ws, strList(v.measurements)) };
  },

  ServiceMetrics: (w, v, op) => {
    const project = findProject(w, v.projectId, op);
    const instance = liveInstances(project).find((i) => i.serviceId === v.serviceId && i.environmentId === v.environmentId);
    if (!instance) return { metrics: [] };
    const ws = w.workspaces.find((x) => x.id === project.workspaceId)!;
    const start = Date.parse(str(v.startDate));
    const end = v.endDate ? Date.parse(str(v.endDate)) : Date.now();
    const step = typeof v.sampleRateSeconds === "number" ? v.sampleRateSeconds : 300;
    return { metrics: metricSeries(instance, ws.plan, strList(v.measurements), start, end, step) };
  },

  DeploymentRuntimeLogs: (w, v, op) => {
    const { deployment } = findDeployment(w, v.deploymentId, op);
    return { deploymentLogs: logLines(deployment, "runtime", typeof v.limit === "number" ? v.limit : 200) };
  },

  DeploymentBuildLogs: (w, v, op) => {
    const { deployment } = findDeployment(w, v.deploymentId, op);
    return { buildLogs: logLines(deployment, "build", typeof v.limit === "number" ? v.limit : 200) };
  },

  // ── Mutations ──

  DeploymentRemove: (w, v, op) => {
    const { instance, deployment } = findDeployment(w, v.id, op);
    if (deployment.status === "REMOVED" || deployment.status === "REMOVING") throw refuse("Deployment is already removed", op);
    const wasActive = instance.activeIds.includes(deployment.id);
    deployment.status = "REMOVED";
    deployment.deploymentStopped = true;
    deployment.updatedAt = iso(Date.now());
    delete deployment.settleAt;
    instance.activeIds = instance.activeIds.filter((id) => id !== deployment.id);
    if (wasActive && instance.activeIds.length === 0) setRates(instance, ZERO_RATES);
    return { deploymentRemove: true };
  },

  DeploymentRestart: (w, v, op) => {
    const { instance, deployment } = findDeployment(w, v.id, op);
    if (!["SUCCESS", "SLEEPING", "CRASHED"].includes(deployment.status)) throw refuse("Deployment can't be restarted", op);
    for (const other of instance.deployments) {
      if (other !== deployment && instance.activeIds.includes(other.id)) {
        other.status = "REMOVED";
        other.deploymentStopped = true;
      }
    }
    deployment.status = "SUCCESS";
    deployment.deploymentStopped = false;
    deployment.updatedAt = iso(Date.now());
    instance.activeIds = [deployment.id];
    setRates(instance, instance.baseRates);
    return { deploymentRestart: true };
  },

  DeploymentRedeploy: (w, v, op) => {
    const { instance, deployment } = findDeployment(w, v.id, op);
    const fresh = newDeploymentFrom(w, instance, deployment, "redeploy");
    instance.deployments.unshift(fresh);
    return { deploymentRedeploy: { id: fresh.id, status: fresh.status } };
  },

  DeploymentRollback: (w, v, op) => {
    const { instance, deployment } = findDeployment(w, v.id, op);
    if (!deploymentNode(deployment).canRollback) throw refuse("Deployment can't be rolled back", op);
    const fresh = newDeploymentFrom(w, instance, deployment, "rollback");
    fresh.status = "DEPLOYING";
    fresh.settleAt = Date.now() + 10_000;
    instance.deployments.unshift(fresh);
    return { deploymentRollback: true };
  },

  DeploymentCancel: (w, v, op) => {
    const { deployment } = findDeployment(w, v.id, op);
    if (!["BUILDING", "DEPLOYING", "INITIALIZING", "QUEUED", "WAITING", "NEEDS_APPROVAL"].includes(deployment.status)) {
      throw refuse("Only in-progress deployments can be cancelled", op);
    }
    deployment.status = "REMOVED";
    deployment.deploymentStopped = true;
    delete deployment.settleAt;
    return { deploymentCancel: true };
  },

  ServiceDelete: (w, v, op) => {
    for (const project of w.projects) {
      const instance = liveInstances(project).find((i) => i.serviceId === v.id && i.environmentId === v.environmentId);
      if (!instance) continue;
      setRates(instance, ZERO_RATES);
      instance.deleted = true;
      instance.activeIds = [];
      for (const vol of project.volumes) {
        if (vol.serviceId === instance.serviceId && vol.environmentId === instance.environmentId && !vol.deletedAt) vol.deletedAt = Date.now();
      }
      if (!liveInstances(project).some((i) => i.serviceId === instance.serviceId)) {
        const svc = project.services.find((s) => s.id === instance.serviceId);
        if (svc) svc.deletedAt = iso(Date.now());
      }
      return { serviceDelete: true };
    }
    throw notFound("Service", op);
  },

  EnvironmentDelete: (w, v, op) => {
    for (const project of w.projects) {
      const env = project.envs.find((e) => e.id === v.id && !e.deleted);
      if (!env) continue;
      env.deleted = true;
      for (const instance of liveInstances(project, env.id)) {
        setRates(instance, ZERO_RATES);
        instance.deleted = true;
        instance.activeIds = [];
      }
      for (const vol of project.volumes) if (vol.environmentId === env.id && !vol.deletedAt) vol.deletedAt = Date.now();
      return { environmentDelete: true };
    }
    throw notFound("Environment", op);
  },

  ProjectScheduleDelete: (w, v, op) => {
    const project = findProject(w, v.id, op);
    project.deletedAt = iso(Date.now());
    return { projectScheduleDelete: true };
  },

  ProjectScheduleDeleteCancel: (w, v, op) => {
    const project = findProject(w, v.id, op);
    project.deletedAt = null;
    return { projectScheduleDeleteCancel: true };
  },
};

export async function mockRequest<T>(doc: GqlDoc, variables: Record<string, unknown>): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, 40 + Math.random() * 90));
  const handler = HANDLERS[doc.name];
  if (!handler) throw new RailwayApiError(`Demo mode has no handler for ${doc.name}`, { kind: "server", operation: doc.name });
  const result = handler(world(), variables, doc.name);
  // Hand back a copy so callers can't mutate the demo world by accident.
  return structuredClone(result) as T;
}
