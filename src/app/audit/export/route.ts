import { connection } from "next/server";

import { readAudit } from "@/lib/audit";

const COLUMNS = [
  "ts",
  "outcome",
  "kind",
  "account",
  "workspace",
  "projectName",
  "projectId",
  "environment",
  "service",
  "targetLabel",
  "targetId",
  "statusAtReview",
  "message",
  "approvedWith",
  "planId",
  "demo",
] as const;

function cell(value: unknown): string {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join(" ") : String(value);
  // Neutralise spreadsheet formulas and quote every field.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  await connection();
  const events = (await readAudit(100_000)).reverse(); // oldest first for spreadsheets
  const lines = [COLUMNS.join(","), ...events.map((e) => COLUMNS.map((c) => cell(e[c])).join(","))];
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="railway-audit-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
