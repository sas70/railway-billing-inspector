import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { RenameTable } from "@/components/RenameTable";
import { SetupGuide } from "@/components/SetupGuide";
import { Notice, PageTitle } from "@/components/ui";
import { aiSummariesAvailable } from "@/lib/code/ai-summary";
import { plural } from "@/lib/format";
import { loadAccountViews } from "@/lib/railway/api";
import { loadRenameRows } from "@/lib/rename";
import { isReadOnly } from "@/lib/write-mode";

export const metadata: Metadata = { title: "Rename projects" };

export default async function RenamePage() {
  await connection();
  const readOnly = await isReadOnly();
  const views = await loadAccountViews();
  if (views.length === 0) return <SetupGuide />;

  const { rows, notes, scheduledForDeletion } = await loadRenameRows(views);
  // Only worth saying where summaries can actually be run (an API key, not the demo or Vercel).
  const needsSummaries =
    aiSummariesAvailable() && rows.some((row) => row.generated && !row.lockReason && row.suggestion?.source !== "ai" && row.repos.length > 0);

  return (
    <div className="space-y-5">
      <PageTitle
        title="Rename projects"
        subtitle="Railway names every new project with two random words, like steadfast-fascination. Give them names that say what they run, all in one review. Suggestions come from each project's saved code summary, or its repo name; edit any of them. Nothing changes until you confirm."
      />

      {notes.map((note) => (
        <Notice key={note} tone="warning">
          {note}
        </Notice>
      ))}

      {needsSummaries && (
        <Notice tone="info">
          Some suggestions only use the repo name. Run <span className="font-medium">Summarize with Claude</span> on the{" "}
          <Link href="/search" className="link">
            Search page
          </Link>{" "}
          for names based on what the code does.
        </Notice>
      )}

      <RenameTable rows={rows} readOnly={readOnly} />

      {scheduledForDeletion > 0 && (
        <p className="text-xs text-ink-2">
          {plural(scheduledForDeletion, "project")} scheduled for deletion {scheduledForDeletion === 1 ? "isn't" : "aren't"} listed.
        </p>
      )}
    </div>
  );
}
