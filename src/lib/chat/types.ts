/** Shared by the chat's server code, its built-in answers and the browser widget. */

export type ChatRole = "user" | "assistant";
export type ChatMessage = { role: ChatRole; content: string };

export type ChatProject = {
  name: string;
  href: string;
  workspace: string;
  about: string | null;
  repos: string[];
  services: number;
  live: number;
  sleeping: number;
  attention: number;
  /** running: something is live · charging: nothing running, still charged lately · stopped: no recent charges */
  status: "running" | "charging" | "stopped";
  costThisPeriod: number;
  costPerDayRecent: number | null;
  biggestCost: string | null;
  /** Services whose deployment Railway stopped but still bills. */
  stoppedButBilled: string[];
  stoppedHref: string | null;
  randomName: boolean;
  protected: boolean;
  lastDeployAt: string | null;
};

export type ChatSnapshot = {
  projects: ChatProject[];
  workspaces: { workspace: string; usageSoFar: number | null; projected: number | null }[];
  offStillCharging: { projects: number; perDay: number };
  stoppedBilling: { services: number; perDay: number | null };
};

export type ChatReply = { content: string; source: "claude" | "built-in" };

export const MAX_MESSAGE = 1500;
export const MAX_HISTORY = 12;

/** The app's screens, for links in answers and the quick actions. */
export const APP_ROUTES = [
  { path: "/", what: "Overview: totals, summary tiles, 'Worth a look', 'Still on this period's bill', and every project by workspace" },
  { path: "/#still-on-bill", what: "the list of projects still on this period's bill (off, but still charging)" },
  { path: "/services", what: "every service in one table, with bulk Turn off / Turn on / Remove stopped" },
  { path: "/services?show=online", what: "services that are live, sleeping or deploying" },
  { path: "/services?show=attention", what: "services that crashed, failed, or whose newest deploy failed" },
  { path: "/services?show=offline", what: "services with nothing live" },
  { path: "/services?show=stopped", what: "services Railway stopped but still bills, with Remove stopped" },
  { path: "/rename", what: "rename projects (suggested names from code summaries; a green check per row, or Select all + Review)" },
  { path: "/search", what: "search projects by keyword or topic across READMEs, summaries and code" },
  { path: "/billing", what: "usage vs plan, projected bill, cost by status and resource per workspace" },
  { path: "/billing/history", what: "daily cost by project" },
  { path: "/audit", what: "the log of every change made from this dashboard" },
] as const;
