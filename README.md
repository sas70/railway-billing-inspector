<p align="center">
  <a href="https://railway-billing-inspector.vercel.app/tour.html">
    <img src="public/tour/banner.webp" width="900" alt="Find what you're still paying for. A ledger lists projects with nothing running that still cost $0.20 a day, circled in red pencil: still charging.">
  </a>
</p>

<p align="center">
  <a href="https://railway-billing-inspector.vercel.app/tour.html"><b>Take the tour</b></a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="https://railway-billing-inspector.vercel.app"><b>Try the live demo</b></a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="#run-it-in-five-minutes"><b>Run it on your account</b></a>
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <a href="docs/GUIDE.md"><b>Full guide</b></a>
</p>

<p align="center">
  <img alt="MIT license" src="https://img.shields.io/badge/license-MIT-2f7a63">
  <img alt="Version 0.4.0" src="https://img.shields.io/badge/version-0.4.0-2a78d6">
  <img alt="Runs on your machine" src="https://img.shields.io/badge/runs-on%20your%20machine-1e2b24">
</p>

**Railway Billing Inspector** is a free, open-source dashboard for your [Railway](https://railway.com) account. It shows where the bill goes, flags projects that charge with nothing running (and the stopped deployments and volumes behind it), answers questions about your projects, finds any project by what it does, and cleans up only after you approve each change. It runs on your own machine; your token never leaves it.

## The short version

<a href="https://railway-billing-inspector.vercel.app/tour.html#story"><img src="public/tour/comic.webp" alt="Comic in four panels. 94 projects, every name picked by a dice roll. Then came the bill: $120 a month. So I built an inspector: everything off in one click, back on only what I need. But some trains kept billing with nobody on board: $0.20 a day. Found you."></a>

## What it found in one of my workspaces

After the cleanup on September 25, nearly all of what this workspace still cost each day was for projects whose deployment history shows nothing running.

| **$14.79** | **14** | **99%** | **$0.20** |
|:--|:--|:--|:--|
| charged with nothing running, in 90 days | projects | of it for memory | a day since the cleanup |

<p>
  <img src="public/tour/idle-usage-per-day.webp" width="49%" alt="Usage per day over 90 days: about $1.74 a day until the September 25 cleanup, then $0.20 a day, nearly all of it for projects with nothing running.">
  <img src="public/tour/idle-charges-by-project.webp" width="49%" alt="$14.79 charged with nothing running across 14 projects in 90 days, led by heroic-contentment at $3.20.">
</p>

These are real numbers from one of my Railway workspaces. I run several Railway accounts and a few on Vercel, so they're a slice of my hosting bill, not all of it.

**Run it on yours and tell me what you find:** the charge, the cause, and how you fixed it. [Open an issue](https://github.com/sas70/railway-billing-inspector/issues/new) and I'll collect what people find.

## What you get

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="public/tour/still-charging-thumb.webp" alt="Still on this period's bill: projects with nothing running and their cost per day, with donuts by status and by what they're charged for.">
      <br><b>Off, but still charging.</b> What Railway actually charged each project over the last two days, so a project with nothing running that still costs money says so, with the reason.
    </td>
    <td width="50%" valign="top">
      <img src="public/tour/stopped-billing-thumb.webp" alt="A pop-up and a banner on the Overview: 2 services stopped, but Railway is still billing them, about $0.07 a day.">
      <br><b>Stopped, but still billed.</b> Railway can stop a deployment yet keep billing its memory. A pop-up and a banner say how many and what they cost, and <b>Remove stopped</b> clears them after a review, all at once or one by one.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="public/tour/volume-insight-thumb.webp" alt="A volume's What's in it? panel: most likely notebook files, 3.03 GB, about $0.02 a day, with Claude's explanation and a Delete volume button.">
      <br><b>What's in that volume?</b> For a volume that keeps billing, a best guess at what it holds from the image, mount path and code, with Claude's explanation, its cost per day and how to keep a copy. <b>Delete volume</b> is one review away.
    </td>
    <td width="50%" valign="top">
      <img src="public/tour/billing-thumb.webp" alt="Billing: usage against the plan, projected cost, and where the money went by status and by resource.">
      <br><b>Where the money went.</b> Usage against what your plan includes, the projected bill, and the cost by status and by resource, for this period and the last.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="public/tour/assistant-thumb.webp" alt="The assistant panel: four quick actions on top, and an answer listing the projects still charging with links.">
      <br><b>Ask about your projects.</b> A bubble on every page with shortcuts to the four key fixes, and answers from your dashboard's data that link to the right screen. It never changes anything itself.
    </td>
    <td width="50%" valign="top">
      <img src="public/tour/summary-tiles-thumb.webp" alt="Overview tiles: projects, live services, needs attention, offline, and a yellow Off, but still charging tile.">
      <br><b>Every number opens its list.</b> Click a tile on the Overview to see exactly what it counts: what's live, what needs attention, what's offline, and what's off but still charging.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="public/tour/search-thumb.webp" alt="Search results ranked by topic match, with the lines that matched.">
      <br><b>Search by topic.</b> Find a project by what it does. An index on your machine covers summaries, READMEs and code, and topic search finds the right project even when your words differ. Projects without a summary get one in the background.
    </td>
    <td width="50%" valign="top">
      <img src="public/tour/rename-thumb.webp" alt="Rename projects: random names ticked, each with a suggested name and a green check.">
      <br><b>Rename projects.</b> Swap Railway's random names like <code>steadfast-fascination</code> for names that say what each app does: a green check renames one row, or <b>Select all</b> and review them together.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src="public/tour/services-thumb.webp" alt="Every service in one sortable table with Turn off buttons.">
      <br><b>Every service, one table.</b> Sort by cost, filter to what's online, needs attention, offline or stopped, and act in bulk, ticking just the ones you want.
    </td>
    <td width="50%" valign="top">
      <img src="public/tour/review-thumb.webp" alt="Review dialog: what will happen, how to undo it, and a phrase to type to approve.">
      <br><b>Nothing changes until you approve it.</b> Review, type the phrase, re-checked on Railway right before it runs, then logged. It starts read-only.
    </td>
  </tr>
</table>

## Run it in five minutes

You need Node.js 20.9 or newer and a Railway account token.

```bash
git clone https://github.com/sas70/railway-billing-inspector.git
cd railway-billing-inspector && npm install
cp .env.example .env.local      # then paste your token after RAILWAY_TOKEN_MAIN=
npm run app                     # open http://127.0.0.1:3100
```

Create the token at [railway.com/account/tokens](https://railway.com/account/tokens) and choose **No workspace**, so one token reads all your workspaces. To look around with no token at all, run `npm run demo`. Add `ANTHROPIC_API_KEY=` to `.env.local` for Claude's summaries, volume explanations and assistant answers; everything else works without it.

## Learn more

- **[Full guide](docs/GUIDE.md):** every page, how approvals work, how the numbers are calculated, the search index, security, and the project layout.
- **[Overview](docs/OVERVIEW.md):** one page on what it does, how changes stay safe, and the Railway actions it uses.
- **[Changelog](CHANGELOG.md):** what's new in each version.
- **[Roadmap](https://railway-billing-inspector.vercel.app/roadmap.html):** what's coming next. Vote, comment or suggest a feature.
- **[Roadmap notes](docs/ROADMAP-NOTES.md):** what's being built, what's done since each release, and the design decisions behind it.
- **[License](LICENSE):** MIT.

Made by [sas70](https://github.com/sas70).
