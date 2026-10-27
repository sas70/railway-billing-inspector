/**
 * Words people use when they name a project themselves. Railway's random names pair an evocative
 * adjective with an abstract noun (steadfast-fascination, lively-vision), so a name with one of
 * these in it was almost certainly chosen by a person.
 */
const HUMAN_WORDS = new Set([
  "admin", "agent", "ai", "alpha", "api", "app", "apps", "assets", "auth", "back", "backend", "beta", "blog", "bot",
  "bots", "cache", "cdn", "chat", "client", "clients", "cms", "cron", "crm", "dash", "dashboard", "data", "database",
  "db", "demo", "dev", "docs", "email", "example", "experiment", "experiments", "front", "frontend", "gateway",
  "internal", "job", "jobs", "lab", "labs", "landing", "legacy", "mail", "main", "ml", "mvp", "my", "new", "old",
  "page", "pages", "personal", "playground", "poc", "portal", "postgres", "preview", "private", "prod", "production",
  "project", "projects", "prototype", "proxy", "public", "queue", "redis", "sample", "sandbox", "server", "service",
  "services", "shop", "site", "stage", "staging", "starter", "static", "storage", "store", "temp", "template", "test",
  "tests", "testing", "tmp", "web", "website", "worker", "workers", "www",
]);

/**
 * Does this look like the random two-word name Railway gives a new project (steadfast-fascination)?
 * Two lowercase words, neither of which is a word people name projects with (api, site, old…) or
 * appears in the project's repo or service names (`hints`): marketing-site deploying acme/site, or
 * upwork-proposals deploying sas70/upwork-proposals, was named by a person. A guess, used only for
 * the "generated name" badge and for which rows the rename table ticks.
 */
export function isGeneratedRailwayName(name: string, hints: readonly string[] = []): boolean {
  const match = /^([a-z]+)-([a-z]+)$/.exec(name.trim());
  if (!match) return false;
  const [, first, second] = match;
  if (HUMAN_WORDS.has(first) || HUMAN_WORDS.has(second)) return false;
  const words = new Set(hints.flatMap((hint) => hint.toLowerCase().split(/[^a-z0-9]+/)).filter(Boolean));
  return !words.has(first) && !words.has(second);
}

/** The project's repo and service names: what a person would name it after. */
export function projectNameHints(project: {
  repos: readonly string[];
  environments: readonly { instances: readonly { serviceName: string }[] }[];
}): string[] {
  return [...project.repos, ...project.environments.flatMap((env) => env.instances.map((instance) => instance.serviceName))];
}
