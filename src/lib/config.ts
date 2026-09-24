import "server-only";

/**
 * Runtime configuration, read from environment variables (.env.local).
 * Tokens never leave the server: nothing in this module is sent to the browser.
 */

export type AccountConfig = {
  /** URL-safe key, e.g. "main" for RAILWAY_TOKEN_MAIN */
  key: string;
  /** Human label, e.g. "Main" */
  label: string;
  token: string;
  /** Only needed for workspace-scoped tokens (or to limit an account token to one workspace). */
  workspaceId?: string;
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);
const flag = (value: string | undefined) => !!value && TRUE_VALUES.has(value.trim().toLowerCase());

export const isMockMode = () => flag(process.env.RAILWAY_MOCK);

/** Hard lock from .env — Write mode in the header cannot override this. */
export const isEnvReadOnly = () => flag(process.env.DASHBOARD_READ_ONLY);

export const WRITE_MODE_COOKIE = "dashboard_write";

function humanize(suffix: string) {
  return suffix
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Every RAILWAY_TOKEN_<NAME> variable becomes one account.
 * (RAILWAY_TOKEN on its own is the Railway CLI's *project* token and is ignored.)
 * RAILWAY_API_TOKEN — the CLI's account-token variable — is picked up as a fallback.
 */
export function getAccounts(): AccountConfig[] {
  if (isMockMode()) {
    return [{ key: "demo", label: "Demo account", token: "mock-token" }];
  }

  const accounts: AccountConfig[] = [];
  const seenKeys = new Set<string>();

  for (const [name, raw] of Object.entries(process.env)) {
    const match = /^RAILWAY_TOKEN_([A-Z0-9_]+)$/.exec(name);
    if (!match) continue;
    const suffix = match[1];
    if (suffix.endsWith("_WORKSPACE_ID")) continue;
    const token = raw?.trim();
    if (!token) continue;

    const key = suffix.toLowerCase().replace(/_+/g, "-").replace(/^-|-$/g, "");
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const workspaceId = process.env[`RAILWAY_TOKEN_${suffix}_WORKSPACE_ID`]?.trim();
    accounts.push({ key, label: humanize(suffix), token, workspaceId: workspaceId || undefined });
  }

  const cliToken = process.env.RAILWAY_API_TOKEN?.trim();
  if (cliToken && !accounts.some((a) => a.token === cliToken) && !seenKeys.has("default")) {
    accounts.push({ key: "default", label: "Railway account", token: cliToken });
  }

  return accounts.sort((a, b) => a.key.localeCompare(b.key));
}

export function getAccount(key: string): AccountConfig | undefined {
  return getAccounts().find((account) => account.key === key);
}

/** PROTECTED_PROJECTS entries (comma-separated names or IDs; use the ID for names containing commas). */
export function protectedEntries(): string[] {
  return (process.env.PROTECTED_PROJECTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Projects listed in PROTECTED_PROJECTS (by name or ID) refuse every change from this dashboard. */
export function isProtectedProject(project: { id: string; name: string }): boolean {
  const list = protectedEntries().map((e) => e.toLowerCase());
  return list.includes(project.id.toLowerCase()) || list.includes(project.name.trim().toLowerCase());
}

/** Entries that match none of the given projects — usually a typo that leaves a project unprotected. */
export function unmatchedProtectedEntries(projects: { id: string; name: string }[]): string[] {
  const known = new Set(projects.flatMap((p) => [p.id.toLowerCase(), p.name.trim().toLowerCase()]));
  return protectedEntries().filter((entry) => !known.has(entry.toLowerCase()));
}

/** An account configured with RAILWAY_TOKEN_<X>_WORKSPACE_ID may only touch that workspace. */
export function workspaceAllowed(account: AccountConfig, workspaceId: string | null | undefined): boolean {
  return !account.workspaceId || account.workspaceId === workspaceId;
}
