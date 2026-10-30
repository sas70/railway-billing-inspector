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
  <img alt="Version 0.2.0" src="https://img.shields.io/badge/version-0.2.0-2a78d6">
  <img alt="Runs on your machine" src="https://img.shields.io/badge/runs-on%20your%20machine-1e2b24">
</p>

**Railway Billing Inspector** is a free, open-source dashboard for your [Railway](https://railway.com) account. It shows where the bill goes, flags projects that charge with nothing running, finds any project by what it does, and cleans up only after you approve each change. It runs on your own machine; your token never leaves it.

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
      <img src="public/tour/billing-thumb.webp" alt="Billing: usage against the plan, projected cost, and where the money went by status and by resource.">
      <br><b>Where the money went.</b> Usage against what your plan includes, the projected bill, and the cost by status and by resource, for this period and the last.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="public/tour/search-thumb.webp" alt="Search results ranked by topic match, with the lines that matched.">
      <br><b>Search by topic.</b> Find a project by what it does. An index on your machine covers summaries, READMEs and code, and topic search finds the right project even when your words differ.
    </td>
    <td valign="top">
      <img src="public/tour/rename-thumb.webp" alt="Rename projects: random names ticked, each with a suggested name.">
      <br><b>Rename projects.</b> Swap Railway's random names like <code>steadfast-fascination</code> for names that say what each app does, several at once.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <img src="public/tour/services-thumb.webp" alt="Every service in one sortable table with Turn off buttons.">
      <br><b>Every service, one table.</b> Sort by cost, filter to what's online, and turn things off in bulk.
    </td>
    <td valign="top">
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

Create the token at [railway.com/account/tokens](https://railway.com/account/tokens) and choose **No workspace**, so one token reads all your workspaces. To look around with no token at all, run `npm run demo`.

## Learn more

- **[Full guide](docs/GUIDE.md):** every page, how approvals work, how the numbers are calculated, the search index, security, and the project layout.
- **[Changelog](CHANGELOG.md):** what's new in each version.
- **[Roadmap](https://railway-billing-inspector.vercel.app/roadmap.html):** what's coming next. Vote, comment or suggest a feature.
- **[License](LICENSE):** MIT.

Made by [sas70](https://github.com/sas70).
