import type { ChatProject, ChatSnapshot } from "./types";

/**
 * Answers without Claude (the demo, or no ANTHROPIC_API_KEY): match a few common questions and
 * answer from the snapshot, with links. Pure, so it is unit-tested.
 */

const money = (n: number | null | undefined) =>
  n == null ? "—" : n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
const link = (p: ChatProject) => `[${p.name}](${p.href})`;
const list = (ps: ChatProject[], fmt: (p: ChatProject) => string, max = 5) =>
  ps
    .slice(0, max)
    .map((p) => `- ${fmt(p)}`)
    .join("\n") + (ps.length > max ? `\n- …and ${ps.length - max} more` : "");

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));

export function findProject(snapshot: ChatSnapshot, question: string): ChatProject | null {
  const q = question.toLowerCase();
  // Longest name first, so "pdf-splitter-old" wins over "pdf-splitter".
  return [...snapshot.projects].sort((a, b) => b.name.length - a.name.length).find((p) => q.includes(p.name.toLowerCase())) ?? null;
}

function describe(p: ChatProject): string {
  const state =
    p.status === "running"
      ? `${p.live} live${p.sleeping ? `, ${p.sleeping} sleeping` : ""}`
      : p.status === "charging"
        ? "nothing running, but still charging"
        : p.status === "unknown" ? "nothing running; recent charges unavailable" : "nothing running, no recent charges";
  const lines = [
    `**${p.name}** (${p.workspace}): ${state}.`,
    p.about ? p.about : null,
    `Cost this period: ${p.costThisPeriod == null ? "unavailable" : money(p.costThisPeriod)}${p.costPerDayRecent != null ? `, about ${money(p.costPerDayRecent)} a day lately` : ""}${p.biggestCost ? `, mostly ${p.biggestCost}` : ""}.`,
    p.attention ? `${p.attention} service${p.attention === 1 ? "" : "s"} need attention.` : null,
    p.stoppedButBilled.length
      ? `Railway stopped ${p.stoppedButBilled.join(", ")} but still bills it: [remove the stopped deployment](${p.stoppedHref ?? "/services?show=stopped"}).`
      : null,
    p.randomName ? "It still has the random name Railway picked: [rename it](/rename)." : null,
    `[Open ${p.name}](${p.href})`,
  ];
  return lines.filter(Boolean).join("\n");
}

function answer(snapshot: ChatSnapshot, question: string, opts: { demo: boolean }): string {
  const q = question.toLowerCase();
  const note = opts.demo ? "\n\n_Demo: these are built-in answers. Run it with your Claude key for full answers._" : "\n\n_Built-in answer. Add ANTHROPIC_API_KEY to .env.local for full answers._";
  const ps = snapshot.projects;

  const project = findProject(snapshot, question);
  if (project) return describe(project) + note;

  if (has(q, "stopped", "still bill")) {
    const s = ps.filter((p) => p.stoppedButBilled.length > 0);
    if (s.length === 0) return `No stopped-but-billed deployments appear in the available project data.${note}`;
    return `${s.length} project${s.length === 1 ? "" : "s"} have a deployment Railway stopped but still bills${snapshot.stoppedBilling.perDay != null ? ` (about ${money(snapshot.stoppedBilling.perDay)} a day)` : ""}:\n${list(s, (p) => `${link(p)}: ${p.stoppedButBilled.join(", ")}`)}\n\n[Review and remove them](/services?show=stopped)${note}`;
  }
  if (has(q, "charg", "cost", "bill", "expensive", "spend", "paying", "money")) {
    const charging = ps.filter((p) => p.status === "charging").sort((a, b) => (b.costPerDayRecent ?? 0) - (a.costPerDayRecent ?? 0));
    const top = [...ps].sort((a, b) => (b.costThisPeriod ?? 0) - (a.costThisPeriod ?? 0)).filter((p) => p.costThisPeriod != null && p.costThisPeriod > 0);
    const parts = [
      top.length ? `Biggest costs this period:\n${list(top, (p) => `${link(p)}: ${money(p.costThisPeriod)}`)}` : (snapshot.dataIssues?.length || ps.some((p) => p.costThisPeriod == null) ? "No positive costs are visible in the available data; costs are incomplete. [Check Billing](/billing)." : "Nothing has cost anything this period."),
      charging.length
        ? `\n${charging.length} project${charging.length === 1 ? "" : "s"} with nothing running still charge, about ${money(snapshot.offStillCharging.perDay)} a day:\n${list(charging, (p) => `${link(p)}: ${money(p.costPerDayRecent)} a day${p.biggestCost ? `, mostly ${p.biggestCost}` : ""}`)}\n\n[See the full list](/#still-on-bill)`
        : null,
    ];
    // "Still charging" questions lead with what's charging; cost questions with the biggest costs.
    const ordered = has(q, "charg", "still") ? [parts[1]?.trimStart() ?? null, parts[0]] : parts;
    return ordered.filter(Boolean).join("\n\n") + note;
  }
  if (has(q, "rename", "name")) {
    const random = ps.filter((p) => p.randomName && !p.protected);
    return `${random.length} project${random.length === 1 ? "" : "s"} still have the random name Railway picked${random.length ? `, like ${random.slice(0, 3).map(link).join(", ")}` : ""}. [Rename them here](/rename): each row has a suggested name and a green check.${note}`;
  }
  if (has(q, "attention", "crash", "fail", "broken", "error", "down")) {
    const bad = ps.filter((p) => p.attention > 0);
    if (bad.length === 0) return `No crashed or failed services appear in the available project data.${note}`;
    return `${bad.length} project${bad.length === 1 ? "" : "s"} need attention:\n${list(bad, (p) => `${link(p)}: ${p.attention} service${p.attention === 1 ? "" : "s"}`)}\n\n[Open them in Services](/services?show=attention)${note}`;
  }
  if (has(q, "live", "running", "online")) {
    const live = ps.filter((p) => p.status === "running");
    return `${live.length} project${live.length === 1 ? " is" : "s are"} running:\n${list(live, (p) => `${link(p)}: ${p.live} live${p.sleeping ? `, ${p.sleeping} sleeping` : ""}`)}\n\n[See them in Services](/services?show=online)${note}`;
  }
  if (has(q, "how many", "projects", "summary", "overview")) {
    return `You have ${ps.length} projects across ${snapshot.workspaces.length} workspace${snapshot.workspaces.length === 1 ? "" : "s"}: ${ps.filter((p) => p.status === "running").length} running, ${ps.filter((p) => p.status === "charging").length} off but still charging, ${ps.filter((p) => p.attention > 0).length} needing attention. [Overview](/)${note}`;
  }
  return `I can answer questions about your Railway projects: what costs money, what's still charging with nothing running, what's broken, what a project does, or where to rename. Try "what's still charging?" or a project name.${note}`;
}

/** Qualify every answer when account, project or usage reads are incomplete. */
export function builtInAnswer(snapshot: ChatSnapshot, question: string, opts: { demo: boolean }): string {
  const issues = snapshot.dataIssues ?? [];
  const prefix = issues.length ? `Data is incomplete: ${issues.join(" ")} The following covers only available data.\n\n` : "";
  return prefix + answer(snapshot, question, opts);
}
