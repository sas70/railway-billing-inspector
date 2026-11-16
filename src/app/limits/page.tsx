import type { Metadata } from "next";
import { connection } from "next/server";

import { LimitsPanel } from "@/components/LimitsPanel";
import { SetupGuide } from "@/components/SetupGuide";
import { Notice, PageTitle } from "@/components/ui";
import { plural } from "@/lib/format";
import { loadLimitRows } from "@/lib/limits";
import { loadAccountViews } from "@/lib/railway/api";
import { isReadOnly } from "@/lib/write-mode";

export const metadata: Metadata = { title: "Usage limits" };

export default async function LimitsPage() {
  await connection();
  const readOnly = await isReadOnly();
  const views = await loadAccountViews();
  if (views.length === 0) return <SetupGuide />;

  const rows = await loadLimitRows(views);
  const atRisk = rows.filter((r) => r.compute.ok && (r.compute.status === "at-limit" || r.compute.status === "projected-over"));
  const uncapped = rows.filter((r) => r.compute.ok && r.compute.status === "no-cap");

  return (
    <div className="space-y-5">
      <PageTitle
        title="Usage limits"
        subtitle="Railway sets spending limits per workspace: a compute email alert and hard limit (at the hard limit Railway takes every service in the workspace offline), and a separate Railway Agent limit. Every project in a workspace counts toward them; Railway has no per-project limit. Nothing changes until you review and confirm."
      />

      {atRisk.length > 0 && (
        <Notice tone="error" title={`${plural(atRisk.length, "workspace")} at or projected past the hard limit`}>
          {atRisk.map((r) => r.workspaceName).join(", ")}: Railway stops services at the hard limit and may act on the projected bill. Raise the
          limit below, or reduce usage, to keep them running.
        </Notice>
      )}
      {uncapped.length > 0 && (
        <Notice tone="info">
          {uncapped.map((r) => r.workspaceName).join(", ")} {uncapped.length === 1 ? "has" : "have"} no compute hard limit, so a runaway service
          has no spending cap.
        </Notice>
      )}

      {rows.length === 0 ? (
        <Notice tone="warning">None of the configured tokens can read a workspace.</Notice>
      ) : (
        <LimitsPanel rows={rows} readOnly={readOnly} />
      )}

      <p className="text-xs text-ink-2">
        Figures are the saved reads shown elsewhere in the dashboard; press Refresh for the latest. Every review re-reads usage, the projected bill
        and the limits from Railway first. Changes are recorded in the audit log.
      </p>
    </div>
  );
}
