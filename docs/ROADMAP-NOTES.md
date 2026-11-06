# Railway Billing Inspector: roadmap notes

_Last updated Nov 6, 2026. The public roadmap is [ROADMAP.md](../ROADMAP.md) and [roadmap.html](https://railway-billing-inspector.vercel.app/roadmap.html); votes and comments are GitHub issue reactions. These notes add the design decisions behind it._

## Now: being built

### AI assistant, step 2: propose and confirm

Step 1 (guide, read-only) shipped: the **Ask** bubble answers from the dashboard's data and links to the right screen. Next, the assistant drafts a change and the server builds the same plan the buttons build (`createPlan`, `createBulkPlan`, `createDescribePlan`, `createRenamePlan`). The chat shows it as a review card with **Confirm** (a typed phrase for destructive actions). Write mode, `PROTECTED_PROJECTS`, the re-checks and the audit log apply unchanged.

## Next: planned

### Rotate secrets in one go

After a breach like Railway's October 21 incident: list every variable that looks like a secret across all projects (names only, never values), group services that share one, paste each new key once, review, and redeploy. Logged like every change.

## Future: later

### AI assistant, step 3: multi-step jobs

One request runs a whole chore, e.g. summarize new repos → copy descriptions → rename random names. Each step is still a reviewed plan; low-risk steps can share one confirm, destructive ones keep their phrase. READMEs and code are untrusted text, so a person's click stays the final say.

## Done

### 0.4.0 (Nov 6, 2026)

- **Assistant, step 1.** Ask bubble with four quick actions and answers from the dashboard's data (Claude with `ANTHROPIC_API_KEY`, built-in answers otherwise and on the demo). Links only.
- **Clickable Overview tiles** and a new **Off, but still charging** tile; Services filters for Needs attention and a stricter Offline.
- **Volumes:** What's in it? (guess from image and mount path, plus Claude's explanation from the code) and **Delete volume** after a review (`volumeDelete`, 48-hour restore window).
- **Rename:** green check per row and Select all.
- **Background summaries** for projects with none, when the Overview opens.
- **Safer changes:** fresh re-checks before bulk and rename actions, saved reads keyed by a hash of each token, credential files kept out of the index, safety tests and CI.
- **Smaller fixes:** Next.js dev badge hidden; the stopped-billing pop-up doesn't cover the bill list when you go to it.

### 0.3.0 (Oct 30, 2026)

Stopped-but-billed deployments flagged and removable (pop-up, banner, Remove stopped with per-item checkboxes); local search index with topic search; Railway reads saved on disk until Refresh; tour page and short README.

### 0.2.0 (Oct 27, 2026)

Off, but still charging (from the last 2 days' real charges); bill summary by status and resource; tabs preloaded; rename projects in bulk; hover summaries; copy summaries into Railway descriptions; "Worth a look" time filter.

## Decided

- Votes on the roadmap use GitHub issues, not a database.
- Rename suggestions are slugs (`acme-status-page`).
- The assistant is a new way into the existing review → confirm → audit engine, never a separate way to change Railway.
- Volume contents are always labeled as an inference: Railway's API can't list a volume's files. Railway backups aren't presented as a safe copy before deleting a volume.
