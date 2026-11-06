import { MAX_HISTORY, MAX_MESSAGE, type ChatMessage } from "./types";

/** Check what the browser sent: the last few turns, trimmed, starting and ending with the user. */
export function parseMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) throw new Error("Bad request.");
  const messages = input
    .slice(-MAX_HISTORY)
    .map((m) => {
      const r = (m ?? {}) as Record<string, unknown>;
      if ((r.role !== "user" && r.role !== "assistant") || typeof r.content !== "string") throw new Error("Bad request.");
      return { role: r.role, content: r.content.slice(0, MAX_MESSAGE) } as ChatMessage;
    })
    .filter((m) => m.content.trim());
  // The API needs the first turn to be the user's.
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length || messages[messages.length - 1].role !== "user") throw new Error("Ask a question first.");
  return messages;
}
