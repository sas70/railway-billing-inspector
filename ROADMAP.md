# Roadmap:

What Railway Billing Inspector does today, what's being built now, and what's planned. Everything here is open for feedback: vote, comment, or suggest something new.

**Interactive version:** [railway-billing-inspector.vercel.app/roadmap.html](https://railway-billing-inspector.vercel.app/roadmap.html), with live votes and ideas from other users.

## How to vote, comment or suggest

Votes and comments live on GitHub issues, so everyone sees the same counts. You need a GitHub account.

- **Vote:** each roadmap item has an issue titled `[Roadmap] …` ([see them all](https://github.com/sas70/railway-billing-inspector/issues?q=is%3Aissue+in%3Atitle+%22%5BRoadmap%5D%22)). React with 👍 or 👎.
- **Comment:** reply on the item's issue.
- **Suggest a feature:** [open a feature idea](https://github.com/sas70/railway-billing-inspector/issues/new?template=feature-idea.yml). The ideas with the most 👍 get looked at first.

---

## Now: being built

### AI assistant, step 2: propose and confirm

Step 1 is out: the **Ask** bubble answers questions and links to the right screen. Next, the assistant drafts the change and shows the same review the buttons show today. Nothing runs until you click **Confirm**.

- Write mode, protected projects and the re-check before each change all still apply.
- Destructive actions still need their typed phrase, and every change goes in the audit log.

## Next: planned

### Rotate secrets in one go

After a breach like Railway's [October 21 security incident](https://railway.com/changelog/2026-10-23-october-21-security-incident), Railway asks you to replace every credential stored in your variables. Doing that service by service is slow and easy to get wrong.

- Lists every variable that looks like a secret (API keys, tokens, database URLs, passwords) across all your projects. Names only: values are never shown.
- Groups the services that share the same secret, so one new value updates all of them.
- You get the new key from its provider (Stripe, OpenAI, your database), paste it once, review every change, and the services redeploy.
- Logged in the audit log, like every other change.

## Future: later

### AI assistant, step 3: multi-step jobs

One request runs a whole chore, such as "summarize my new apps, copy the descriptions, rename the generated names".

- Each step is still reviewed. Low-risk steps can share one confirm; destructive steps always ask for their own phrase.
- The assistant reads READMEs and code, and text in a repo could try to steer it, so a person's click stays the final say.

---

## Done

**New in 0.4.0**

- **Ask about your projects (assistant, step 1).** A bubble on every page with four quick actions (Remove stopped deployments, Rename projects, Off but still charging, Needs attention) and answers from your dashboard's data that link to the right screen. Read-only: it never changes anything.
- **Every number opens its list.** The Overview tiles link to exactly what they count, and a new **Off, but still charging** tile shows the cost per day and the stopped deployments ready to remove.
- **What's in that volume?** A best guess at what a billing volume holds, from its image, mount path and code, with Claude's explanation, and **Delete volume** after a review.
- **Rename in one click.** A green check per row, plus **Select all**.
- **Summaries write themselves.** Projects with no summary get one in the background when the Overview opens.
- **Safer changes.** Fresh re-checks before bulk and rename actions, saved reads tied to each token, credential files kept out of the search index, and checks on every push.

**In 0.3.0**

- **Stopped, but still billed.** Railway can stop a deployment yet keep billing its memory. A pop-up and banner flag them, and **Remove stopped** clears them after a review, with a checkbox per item.
- **Search index and topic search.** Search answers from an index on your machine, by keyword or by topic.
- **Nothing re-read until Refresh.** What was read from Railway is saved on disk and reused until you press Refresh.
- **A tour page and a short README.**

**Already in the app**

- **Off, but still charging.** Projects with nothing running that Railway actually charged in the last 2 days, with the cost per day and what it's for (CPU, memory, network or storage).
- **Bill summary first.** Above the project list: what idle projects cost per day, this period's cost by status, and what they're charged for. The Billing page shows the same split for this and last period.
- **Tabs stay loaded.** The other tabs load in the background and come up instantly. One Refresh button reads everything again.
- **Rename projects.** Swap Railway's random names like `steadfast-fascination` for names that say what each app does, several at once. Names are suggested from each app's saved summary (or its repo name), the random ones are ticked for you, and one review covers every old → new name.
- **Hover summaries.** Hover a project or service name to see what its code does.
- **Railway descriptions.** Copy each app's saved summary into its Railway project description, after one review.
- **"Worth a look" time filter.** Show only what happened today, this week (the default), this month, this year, or everything. Charges get their own "Still on this period's bill" list, which says whether each one is still charging or stopped earlier.

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
