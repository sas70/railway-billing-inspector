# Changelog

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
