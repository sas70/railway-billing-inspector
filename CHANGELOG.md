# Changelog

## 0.4.0 (November 2026)

**See what's behind every charge, and ask about it.**

- **Ask about your projects.** A bubble at the bottom right of every page opens an assistant. At the top: four quick actions (Remove stopped deployments, Rename projects, Off but still charging, Needs attention). Below: ask in plain words, like "what's still charging me?" or a project's name, and get an answer from the dashboard's own data (projects, status, costs, recent charges, stopped deployments, summaries; never variables or tokens) with links to the right project or screen. With `ANTHROPIC_API_KEY`, Claude answers, only about your Railway projects and this dashboard; without it, and on the demo, built-in answers cover the common questions. It only links: every change still goes through its review. The conversation stays for the browser tab.
- **Every number opens its list.** The Overview tiles are links: **Projects** jumps to the project tables, and **Live services**, **Needs attention** and **Offline / removed** open Services filtered to exactly what they count. A new yellow tile, **Off, but still charging**, shows how many projects with nothing running Railway charged in the last 2 days, the cost per day, and how many stopped deployments are ready to remove; it opens the full bill list. Services has a new **Needs attention** filter, and **Offline** now means nothing live and nothing broken, matching the tile. Filters can be linked to with `/services?show=online|attention|offline|stopped`.
- **What's in that volume?** On a project page, each volume has a **What's in it?** panel: an instant guess from the attached image and mount path (Redis data, a PostgreSQL database, notebook files…), what it costs per day and month, and how to keep a copy. **Explain with Claude** reads the image, size, other services and the repo's code and writes a paragraph on what it most likely holds, labeled as an inference, since Railway can't list a volume's files. Saved under `data/volume-notes/`.
- **Delete volume.** From the same panel, after a review that shows the size, the cost per day, what it most likely holds, whether a running service uses it, any Railway backups, Railway's 48-hour restore window and how to keep a copy first. Type the volume name to approve (Railway `volumeDelete`).
- **Rename in one click.** Each row on **Rename projects** has a green check (or press Enter) that renames just that project, with the same fresh check, protected-project rule and audit log as the bulk review. **Select all** ticks every project that has a name ready.
- **Summaries write themselves.** When the Overview opens, projects whose repo has no summary get one in the background (with `ANTHROPIC_API_KEY`); a status line shows progress. Each repo is tried once per start, and new summaries feed the rename suggestions.
- **Smaller fixes.** The Next.js "N" badge no longer shows in `npm run dev`, and the stopped-but-billed pop-up doesn't cover the bill list when you go to it on purpose.

**Safer changes**

- Bulk turn-on rechecks service state immediately before execution and skips services already online or deploying. Bulk reviews fetch fresh project and service state.
- Single-project rename skips names changed since review, matching bulk rename behavior.
- Saved Railway reads are isolated by credential fingerprint, workspace scope, and query version. Existing cache entries are ignored by the new format.
- Code indexing excludes common credential files and symlinks, and rejects paths outside the repository. The next index update reprocesses repositories with these rules.
- Added approval, cache-isolation, and index-path regression tests, plus CI for tests, type checking, and production builds.

Upgrading: `git pull`, then `npm run app`. No new packages. The first load reads Railway again (saved reads now use a new, per-token format), and the next search index update re-reads every repo with the new file rules.

## 0.3.0 (October 2026)

**Stop paying for deployments Railway already stopped.**

- **Stopped, but still billed.** Railway can mark a deployment stopped yet keep it on the service's active list, and keep billing its memory (about 110 MB, roughly $0.035 a day each); most came from Railway's 2025 runtime migration. The dashboard now flags these on the Overview, in the deployment history, and on the service page, and removes them after the usual review: one at a time from the service page, or all at once with **Services → Remove stopped**.
- **You can't miss it now.** When Railway is billing deployments it stopped, the Overview opens with a pop-up (once per visit) and a pulsing banner with the count and the cost per day. Both lead to **Services**, filtered to just those services, with **Remove stopped** highlighted.
- **Pick what runs.** Every bulk review (turn on, turn off, remove stopped) now has a checkbox per item and **Select all**. Untick anything you want to leave alone; the phrase to type counts only what's ticked.
- **Search index.** Search now answers from an index kept on your machine, built in the background the first time the dashboard opens and updated once a day (or with **Update**). Keyword search covers project details, summaries, READMEs and code, ranked by relevance, and **topic search** finds projects about the same subject even when the words differ, using a small embedding model that runs locally. Each result says why it matched. Repos that exist only on GitHub are copied once into `data/search-index/repos`, so their code is searchable without GitHub's rate limits. Regex and match-case searches still run live. Run `npm install` after updating.
- **Nothing is re-read until you press Refresh.** Railway reads no longer expire after an hour: they are saved on disk (`data/railway-cache.sqlite`, git-ignored) and reused across restarts until you press Refresh or make a change from the dashboard. READMEs, local clones and summary checks are also kept until Refresh. Railway reads slower than 3 seconds are logged in the terminal.
- **A tour and a shorter README.** An interactive page at `/tour.html` (on the demo site too) with a four-panel comic, real findings, a feature explorer, the approval steps and a copy-and-paste quick start. The README is now a short, visual introduction; the full details moved to [docs/GUIDE.md](docs/GUIDE.md).
- **Review dialogs read left to right again.** Opened from a table's right-aligned column, they inherited that alignment.

Upgrading: run `npm install` (the search index uses new packages), then `npm run app`.

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
