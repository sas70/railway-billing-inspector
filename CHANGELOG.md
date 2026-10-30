# Changelog

## Unreleased

- **Stopped, but still billed.** Railway can mark a deployment stopped yet keep it on the service's active list, and keep billing its memory (about 110 MB, roughly $0.035 a day each); most came from Railway's 2025 runtime migration. The dashboard now flags these on the Overview, in the deployment history, and on the service page, and removes them after the usual review: one at a time from the service page, or all at once with **Services → Remove stopped**.
- **A tour and a shorter README.** An interactive page at `/tour.html` (on the demo site too) with a four-panel comic, real findings, a feature explorer, the approval steps and a copy-and-paste quick start. The README is now a short, visual introduction; the full details moved to [docs/GUIDE.md](docs/GUIDE.md).
- **Review dialogs read left to right again.** Opened from a table's right-aligned column, they inherited that alignment.

- **Search index.** Search now answers from an index kept on your machine, built in the background the first time the dashboard opens and updated once a day (or with **Update**). Keyword search covers project details, summaries, READMEs and code, ranked by relevance, and **topic search** finds projects about the same subject even when the words differ, using a small embedding model that runs locally. Each result says why it matched. Repos that exist only on GitHub are copied once into `data/search-index/repos`, so their code is searchable without GitHub's rate limits. Regex and match-case searches still run live. Run `npm install` after updating.
- **Nothing is re-read until you press Refresh.** Railway reads no longer expire after an hour: they are saved on disk (`data/railway-cache.sqlite`, git-ignored) and reused across restarts until you press Refresh or make a change from the dashboard. READMEs, local clones and summary checks are also kept until Refresh. Railway reads slower than 3 seconds are logged in the terminal.

## 0.2.0 (October 2026)

**Find what you're paying for with nothing running.**

- **Off, but still charging.** The Overview's "Still on this period's bill" list now checks what Railway actually charged each project in the last 2 full days, instead of Railway's projection. A project with nothing running that was still charged says so, with the cost per day and what it's for: CPU or memory (something is still allocated somewhere), network egress, or volume storage (billed every day until the volume is deleted).
- **Bill summary first.** Above that list: what projects with nothing running cost per day, and roughly by the end of the billing period, this period's cost by status, and what those projects are charged for.
- **Where the money went.** The Billing page shows two donuts per workspace, by status and by resource, for this period and the previous one.
- **Rename projects.** One table to swap Railway's random names (`steadfast-fascination`) for names that say what each app does, with suggestions from each app's code summary and one review for every change.
- **Hover summaries.** Hover a project or service name to see what its code does.
- **Railway descriptions.** Copy each app's saved summary into its Railway project description, after one review.
- **Tabs stay loaded.** Railway reads are kept until you press Refresh (at most an hour, and cleared after any change made from the dashboard). The other tabs load in the background, so switching between them is instant. The label next to Refresh says how old the data is. Use `npm run app` for the full effect.

## 0.1.0 (October 2026)

First public release: Overview, Services, project and service pages, Billing and cost history, Search and AI summaries, and approval-gated cleanups with an audit log.
