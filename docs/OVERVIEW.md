# Railway Billing Inspector

_Last updated Nov 6, 2026._

A free, open-source dashboard for your Railway account(s) that runs on your own machine. It shows where the bill goes, flags what charges with nothing running (and why), answers questions about your projects, finds any project by what it does, and cleans up only after you approve each change.

- **Repo:** [sas70/railway-billing-inspector](https://github.com/sas70/railway-billing-inspector) (public, MIT).
- **Demo:** [railway-billing-inspector.vercel.app](https://railway-billing-inspector.vercel.app) (fake data), with a [tour](https://railway-billing-inspector.vercel.app/tour.html) and a [roadmap](https://railway-billing-inspector.vercel.app/roadmap.html).
- **Version:** 0.4.0 (November 2026). What changed in each version: the [changelog](../CHANGELOG.md).
- **Full details:** [the guide](GUIDE.md). Plans and decisions: [roadmap notes](ROADMAP-NOTES.md).

## What it does

- **Overview.** Every workspace and project with health, cost so far and projected. The tiles are links (Projects, Live services, Needs attention, Offline / removed), and a yellow **Off, but still charging** tile shows projects with nothing running that Railway charged in the last 2 days, the cost per day, and stopped deployments ready to remove. "Worth a look" lists crashes and failed deploys by time; "Still on this period's bill" lists what is still charging.
- **Stopped, but still billed.** Railway can mark a deployment stopped yet keep billing its memory (about 110 MB, ~$0.035/day each; mostly from its 2025 runtime migration). A pop-up and a pulsing banner flag them; **Services → Remove stopped** clears them after a review, with a checkbox per item.
- **Services.** Every service in one sortable table, filtered by Online / Needs attention / Offline / Stopped, still billing (`/services?show=…`), with bulk actions that are reviewed first.
- **Project and service pages.** Cost by service and resource, charts, deployment history and logs. Each volume has **What's in it?** (a guess from the image and mount path, plus an on-demand Claude explanation from the code) and **Delete volume** after a review.
- **Rename projects.** Swap Railway's random names for clear ones: suggestions from each repo's summary, a green check per row, or Select all + one review.
- **Search and summaries.** A local search index (keyword + topic). Claude summarizes each repo; projects with no summary get one in the background when the Overview opens.
- **Assistant.** The **Ask** bubble on every page: four quick actions (Remove stopped deployments, Rename projects, Off but still charging, Needs attention) and answers from the dashboard's data, with links. It never changes anything.
- **Billing and cost history.** Usage vs plan, projected bill, invoices, cost by status and resource, and a 7- or 30-day comparison.
- **Audit log.** Every approved change, exportable as CSV.

## Quick start

1. Node.js 20.9+, then `npm install`.
2. Create a Railway token at railway.com/account/tokens with **No workspace**, so one token reads every workspace.
3. `cp .env.example .env.local` and set `RAILWAY_TOKEN_MAIN=`. Optional: `ANTHROPIC_API_KEY=` for summaries, volume explanations and assistant answers.
4. `npm run app` for everyday use (fast), `npm run dev` while editing code, `npm run demo` for fake data. Open http://127.0.0.1:3100.

## How changes stay safe

- Every change is a reviewed plan: the server re-reads Railway, lists exactly what changes and what is skipped, and explains the effect and the undo.
- Destructive actions need a typed phrase (`REMOVE 3 STOPPED`, or the exact name). Plans are single-use and expire after 10 minutes.
- Each item is re-checked on Railway right before it runs; anything that changed is skipped. Every change is written to the audit log first.
- Read-only until you turn on Write mode; `PROTECTED_PROJECTS` can't be changed at all.
- Tokens stay on the server, the app binds to 127.0.0.1, saved reads are keyed by a hash of the token, and credential files are kept out of the search index.
- Saved Railway reads are kept on disk until you press **Refresh**.

## Railway actions it uses

| Action | Railway API | Undo |
|---|---|---|
| Remove deployment / Remove stopped | `deploymentRemove` | Redeploy or roll back |
| Restart, Redeploy, Roll back, Cancel build | `deploymentRestart` / `deploymentRedeploy` / `deploymentRollback` / `deploymentCancel` | — |
| Delete service / environment | `serviceDelete` / `environmentDelete` | Not reversible |
| Delete volume | `volumeDelete` | Restore within 48 h from Railway's email |
| Rename project, copy descriptions | `projectUpdate` | Rename or edit again |
| Delete project | `projectScheduleDelete` | Cancel within 48 h |

`npm run check:queries` validates all 28 GraphQL operations against Railway's live schema. `npm test` runs the unit and safety tests; GitHub Actions runs tests, typecheck and a demo build on every push.
