import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { aiSummariesAvailable, SUMMARY_MODEL } from "../code/ai-summary";
import { isMockMode } from "../config";
import { builtInAnswer } from "./built-in";
import { chatSnapshot } from "./context";
import { parseMessages } from "./messages";
import { APP_ROUTES, type ChatReply, type ChatSnapshot } from "./types";

/**
 * The dashboard's assistant. It answers only about the user's Railway projects and this
 * dashboard, from a snapshot of the dashboard's own data, and links to the screen where the user
 * can act. It never changes anything: every change still goes through a review.
 */

const SYSTEM = `You are the assistant inside "Railway Billing Inspector", a dashboard for one developer's Railway account. You answer questions about their Railway projects, services, costs and this dashboard, using only the snapshot below. If a question is about anything else, say briefly that you only help with their Railway projects and this dashboard.

Rules:
- Be short and concrete: a sentence or two, or a short list. Use the real names and dollar amounts from the snapshot. Never invent projects, numbers or features.
- If the snapshot doesn't hold the answer, say so and point to the screen that would show it.
- You can't change anything. When the user wants to act (rename, remove, delete, turn off), link to the screen where they can, and mention that the dashboard shows a review they approve.
- Link with Markdown, only to paths from the snapshot (project "href" values, "stoppedHref", or the app screens list). Example: [heroic-contentment](/a/main/p/abc). No other URLs.
- "charging" means nothing is running but Railway charged it in the last ${2} days; "stoppedButBilled" lists services whose deployment Railway marked stopped but still bills for memory.
- Costs are estimates from Railway's usage; the invoice is authoritative.`;

function snapshotText(s: ChatSnapshot): string {
  return JSON.stringify({
    screens: APP_ROUTES,
    workspaces: s.workspaces,
    offStillCharging: s.offStillCharging,
    stoppedBilling: s.stoppedBilling,
    projects: s.projects.map((p) => ({
      ...p,
      costThisPeriod: Math.round(p.costThisPeriod * 100) / 100,
      costPerDayRecent: p.costPerDayRecent == null ? null : Math.round(p.costPerDayRecent * 1000) / 1000,
    })),
  });
}

let client: Anthropic | null = null;

export async function answerChat(input: unknown): Promise<ChatReply> {
  const messages = parseMessages(input);
  const snapshot = await chatSnapshot();
  const question = messages[messages.length - 1].content;
  if (isMockMode() || !aiSummariesAvailable()) {
    return { content: builtInAnswer(snapshot, question, { demo: isMockMode() }), source: "built-in" };
  }
  client ??= new Anthropic();
  const response = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1200,
    system: [
      { type: "text", text: SYSTEM },
      // The snapshot changes only when the dashboard re-reads Railway, so cache it between questions.
      { type: "text", text: `Snapshot of the dashboard (JSON):\n${snapshotText(snapshot)}`, cache_control: { type: "ephemeral" } },
    ],
    messages,
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { content: text || "I couldn't find an answer to that in the dashboard's data.", source: "claude" };
}
