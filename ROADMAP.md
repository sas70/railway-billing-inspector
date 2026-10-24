# Roadmap

What Railway Billing Inspector does today, what's being built now, and what's planned. Everything here is open for feedback: vote, comment, or suggest something new.

**Interactive version:** [railway-billing-inspector.vercel.app/roadmap.html](https://railway-billing-inspector.vercel.app/roadmap.html), with live votes and ideas from other users.

## How to vote, comment or suggest

Votes and comments live on GitHub issues, so everyone sees the same counts. You need a GitHub account.

- **Vote:** each roadmap item has an issue titled `[Roadmap] …` ([see them all](https://github.com/sas70/railway-billing-inspector/issues?q=is%3Aissue+in%3Atitle+%22%5BRoadmap%5D%22)). React with 👍 or 👎.
- **Comment:** reply on the item's issue.
- **Suggest a feature:** [open a feature idea](https://github.com/sas70/railway-billing-inspector/issues/new?template=feature-idea.yml). The ideas with the most 👍 get looked at first.

---

## Now: being built

### Bulk rename table

Railway gives new projects two-word names like `steadfast-fascination`. This table replaces them with names that say what each app does.

- One row per project: current name, suggested name, and a checkbox.
- Suggestions come from each app's saved AI summary, written as slugs like `room-shell-matcher`. Every suggestion can be edited.
- Railway's generated names are ticked for you.
- **Rename selected** shows one review of every old → new name, then runs after one confirm.
- Each rename is recorded in the audit log. Only the display name changes: domains, services and billing stay the same.

## Next: planned

### AI assistant, step 1: guide

Ask in plain words, like "which apps cost the most?" or "I want to summarize my apps", and get an answer or a link to the page that does it.

- Answers from your dashboard's data: projects, costs, status and saved summaries.
- Read-only: it can't change anything.

### AI assistant, step 2: propose and confirm

The assistant drafts the change and shows the same review the buttons show today. Nothing runs until you click **Confirm**.

- Write mode, protected projects and the re-check before each change all still apply.
- Destructive actions still need their typed phrase, and every change goes in the audit log.

## Future: later

### AI assistant, step 3: multi-step jobs

One request runs a whole chore, such as "summarize my new apps, copy the descriptions, rename the generated names".

- Each step is still reviewed. Low-risk steps can share one confirm; destructive steps always ask for their own phrase.
- The assistant reads READMEs and code, and text in a repo could try to steer it, so a person's click stays the final say.

---

## Done

**New in this release**

- **Hover summaries.** Hover a project or service name to see what its code does.
- **Railway descriptions.** Copy each app's saved summary into its Railway project description, after one review.
- **"Worth a look" time filter.** Show only what happened today, this week (the default), this month, this year, or everything. Anything still costing money always shows.

**Already in the app**

- **Overview.** Every workspace and project with health, cost so far and projected cost, plus a "Worth a look" list of crashed services, failed deploys and forgotten PR environments.
- **Services.** Every service in one sortable table, with Turn on / Turn off and bulk on/off, each reviewed first.
- **Project and service pages.** Cost by service and resource, environments, volumes, CPU / memory / egress charts, deployment history and logs.
- **Billing and cost history.** Usage against your plan, projected cost, invoices, and a 7- or 30-day comparison of what changed.
- **Search and AI summaries.** Find an app by what it does. Claude summarizes each repo's code once and only re-runs when the code changes.
- **Safe changes.** Every change is reviewed, approved, re-checked right before it runs, and logged. Read-only until you turn on Write mode; protected projects can't be changed.
- **Runs on your machine.** Local-only by default, tokens never reach the browser, and a demo with fake data needs no token.

---

_Maintainers: the items above also live in `public/roadmap.html` (the `ROADMAP` list near the top of its script). Update both when the plan changes. To open voting on an item, use its "Start the discussion" button on the roadmap page; it opens a pre-filled `[Roadmap]` issue._
