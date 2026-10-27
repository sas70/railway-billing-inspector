import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { buttonClass } from "@/components/button";
import { DescribeButton } from "@/components/DescribeSummaries";
import { Icon } from "@/components/Icon";
import { SetupGuide } from "@/components/SetupGuide";
import { SummaryControls } from "@/components/SummaryControls";
import { Badge, Card, CardHeader, EmptyState, HealthSummary, Notice, PageTitle } from "@/components/ui";
import { codeSetup, makeMatcher, repoInfos, searchCode, type RepoInfo, type SearchOptions } from "@/lib/code";
import { aiSummariesAvailable, savedSummaries, startSummaryJob, summaryJob, summaryStatuses, type SummaryJob, type SummaryStatus } from "@/lib/code/ai-summary";
import { matchingLines } from "@/lib/code/readme";
import { repoKey } from "@/lib/code/sources";
import { isMockMode } from "@/lib/config";
import { plural } from "@/lib/format";
import { isReadOnly } from "@/lib/write-mode";
import { isOnlineHealth, needsAttention } from "@/lib/health";
import { loadAccountViews, loadWorkspaceBundle, uniqueWorkspaceTargets, type ProjectSummary } from "@/lib/railway/api";

export const metadata: Metadata = { title: "Search" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

type Scope = "projects" | "readme" | "code";
type Status = "all" | "online" | "offline" | "attention";

/** Repo info plus its saved AI summary (if any). */
type Info = RepoInfo & { ai?: SummaryStatus };

type Entry = {
  project: ProjectSummary;
  accountKey: string;
  workspace: { id: string; name: string };
  href: string;
};

function statusOf(project: ProjectSummary): Status[] {
  const online = project.environments.some((e) => e.instances.some((i) => isOnlineHealth(i.health)));
  return [online ? "online" : "offline", ...(needsAttention(project.health) > 0 ? (["attention"] as const) : [])];
}

/** Wrap every hit in <mark>. */
function Highlight({ text, o }: { text: string; o: Pick<SearchOptions, "query" | "regex" | "caseSensitive"> }) {
  if (!text) return null;
  let re: RegExp;
  try {
    re = new RegExp(o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), o.caseSensitive ? "g" : "gi");
  } catch {
    return <>{text}</>;
  }
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) break;
    parts.push(text.slice(last, m.index), <mark key={m.index} className="rounded-sm bg-(--warning-wash) px-0.5 text-ink">{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function SourceBadge({ info }: { info: RepoInfo | undefined }) {
  if (!info) return null;
  const s = info.source;
  if (s.kind === "local") return <Badge title={`${s.dir}${s.matchedBy === "folder" ? " (matched by folder name)" : ""}`}>local</Badge>;
  if (s.kind === "github") return <Badge tone="info">GitHub</Badge>;
  if (s.kind === "mock") return <Badge tone="info">demo</Badge>;
  return <Badge tone="warning" title={s.reason}>not readable</Badge>;
}

function RepoLink({ repo }: { repo: string }) {
  return (
    <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 font-mono text-xs">
      {repo}
      <Icon name="external" size={10} />
    </a>
  );
}

export default async function SearchPage({ searchParams }: Props) {
  await connection();
  const sp = await searchParams;
  const query = one(sp.q).trim();
  const submitted = one(sp.s) === "1";
  const scopes = new Set<Scope>(submitted ? (many(sp.in).filter((s) => ["projects", "readme", "code"].includes(s)) as Scope[]) : ["projects", "readme", "code"]);
  const o: SearchOptions = { query, regex: one(sp.regex) === "1", caseSensitive: one(sp.case) === "1", pathFilter: one(sp.path).trim() };
  const wsFilter = one(sp.ws);
  const status = (["online", "offline", "attention"].includes(one(sp.status)) ? one(sp.status) : "all") as Status;
  const fresh = one(sp.fresh) === "1";
  const repoFilter = one(sp.repo).trim();

  const accounts = await loadAccountViews();
  if (accounts.length === 0) return <SetupGuide />;
  const bundles = await Promise.all(uniqueWorkspaceTargets(accounts).map(({ account, workspace }) => loadWorkspaceBundle(account, workspace)));

  const workspaces = bundles.map((b) => b.workspace);
  const entries: Entry[] = bundles
    .filter((b) => !wsFilter || b.workspace.id === wsFilter)
    .flatMap((b) =>
      (b.projects.ok ? b.projects.value : []).map((project) => ({
        project,
        accountKey: b.account.key,
        workspace: { id: b.workspace.id, name: b.workspace.name },
        href: `/a/${b.account.key}/p/${project.id}`,
      })),
    )
    .filter((e) => status === "all" || statusOf(e.project).includes(status))
    .filter((e) => !repoFilter || e.project.repos.some((r) => repoKey(r) === repoKey(repoFilter)))
    .sort((a, b) => a.project.name.localeCompare(b.project.name));

  const repos = repoFilter ? [repoFilter] : [...new Set(entries.flatMap((e) => e.project.repos))];
  const aiOn = aiSummariesAvailable();
  // Demo mode has built-in stand-in summaries (no Claude calls), so show them too.
  const showSummaries = aiOn || isMockMode();
  const [setup, readmes, statuses, readOnly, saved] = await Promise.all([
    codeSetup(),
    repoInfos(repos, fresh),
    showSummaries ? summaryStatuses(repos) : Promise.resolve(new Map<string, SummaryStatus>()),
    isReadOnly(),
    // Copying to Railway only needs the saved files, not an API key.
    savedSummaries(repos),
  ]);
  const summarized = saved.size;
  const infos = new Map<string, Info>([...readmes].map(([k, i]) => [k, { ...i, ai: statuses.get(k) }]));
  // Code changed since a saved summary → refresh just those in the background.
  const stale = repos.filter((r) => statuses.get(repoKey(r))?.stale);
  if (aiOn && stale.length > 0 && !summaryJob().running) startSummaryJob(stale);
  const job = summaryJob();
  const missingAi = repos.filter((r) => {
    const st = statuses.get(repoKey(r));
    return st && (!st.stored || st.stale);
  }).length;
  const projectsByRepo = new Map<string, Entry[]>();
  for (const e of entries) for (const r of e.project.repos) projectsByRepo.set(repoKey(r), [...(projectsByRepo.get(repoKey(r)) ?? []), e]);
  const infoOf = (repo: string): Info | undefined => infos.get(repoKey(repo));

  const matcher = query ? makeMatcher(o) : null;
  const haystack = (e: Entry) =>
    [
      e.project.name,
      e.project.description ?? "",
      e.workspace.name,
      e.project.id,
      ...e.project.repos,
      ...e.project.publicDomains,
      ...e.project.environments.flatMap((env) => env.instances.map((i) => i.serviceName)),
      ...e.project.repos.flatMap((r) => {
        const i = infoOf(r);
        const ai = i?.ai?.stored?.summary;
        return [
          i?.description ?? "",
          i?.readme?.title ?? "",
          i?.readme?.summary ?? "",
          ...(ai ? [ai.name, ai.summary, ...ai.stack, ...ai.features, ...ai.services, ...ai.keywords] : []),
        ];
      }),
    ].join("\n");
  const projectHits =
    query && scopes.has("projects") && !matcher?.error
      ? entries.filter((e) => {
          const hay = haystack(e);
          if (o.regex) return matcher!.test(hay.replace(/\n/g, " ")) >= 0;
          const h = o.caseSensitive ? hay : hay.toLowerCase();
          return query.split(/\s+/).every((t) => h.includes(o.caseSensitive ? t : t.toLowerCase()));
        })
      : [];

  const readmeHits =
    query && scopes.has("readme") && !matcher?.error
      ? repos
          .map((repo) => ({ repo, info: infoOf(repo), lines: infoOf(repo)?.readme ? matchingLines(infoOf(repo)!.readme!.text, matcher!.test, 3) : [] }))
          .filter((r) => r.lines.length > 0)
      : [];

  const code = query && scopes.has("code") ? await searchCode(repos, o) : null;
  const codeMatches = code?.results.reduce((n, r) => n + r.matches.length, 0) ?? 0;

  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of many(v)) p.append(k, x);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/search?${p}`;
  };
  const unreadable = repos.filter((r) => infoOf(r)?.source.kind === "none");
  const projectsWithoutRepo = entries.filter((e) => e.project.repos.length === 0).length;

  return (
    <div className="space-y-6">
      <PageTitle
        title="Search"
        subtitle="Find a project by what it does, not by the name Railway gave it. Searches project names, services, domains and repos, each repo's README, and the code itself — read-only, from your local clones or GitHub."
      />

      <Card className="p-5">
        <form action="/search" method="get" className="space-y-4">
          <input type="hidden" name="s" value="1" />
          {repoFilter && <input type="hidden" name="repo" value={repoFilter} />}
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-0 flex-1 basis-72">
              <label className="sr-only" htmlFor="search-q">Search</label>
              <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-3 text-ink-2" />
              <input
                id="search-q"
                name="q"
                type="search"
                defaultValue={query}
                autoFocus
                placeholder="e.g. stripe checkout, postmark, “client portal”, OPENAI_API_KEY…"
                className="h-10 w-full rounded-lg border border-line bg-page pl-9 pr-3 text-sm placeholder:text-ink-2 focus:border-(--series-1)"
              />
            </div>
            <button type="submit" className={buttonClass("primary", "md")}>
              Search
            </button>
          </div>

          <details className="group text-sm" open={submitted && (o.regex || o.caseSensitive || !!o.pathFilter || !!wsFilter || status !== "all" || scopes.size < 3)}>
            <summary className="cursor-pointer select-none text-xs font-medium text-ink-2 hover:text-ink">Advanced options</summary>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs text-ink-2">Search in</legend>
                {(
                  [
                    ["projects", "Project details"],
                    ["readme", "READMEs"],
                    ["code", "Code"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2">
                    <input type="checkbox" name="in" value={value} defaultChecked={scopes.has(value)} /> {label}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs text-ink-2">Matching</legend>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="regex" value="1" defaultChecked={o.regex} /> Regular expression
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="case" value="1" defaultChecked={o.caseSensitive} /> Match case
                </label>
              </fieldset>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-2">File path contains</span>
                <input
                  name="path"
                  defaultValue={o.pathFilter}
                  placeholder="src/, .py, Dockerfile…"
                  className="h-9 w-full rounded-lg border border-line bg-page px-3 text-sm placeholder:text-ink-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-1">
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2">Workspace</span>
                  <select name="ws" defaultValue={wsFilter} className="h-9 w-full rounded-lg border border-line bg-page px-2 text-sm">
                    <option value="">All workspaces</option>
                    {workspaces.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-ink-2">Status</span>
                  <select name="status" defaultValue={status} className="h-9 w-full rounded-lg border border-line bg-page px-2 text-sm">
                    <option value="all">Any status</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline</option>
                    <option value="attention">Needs attention</option>
                  </select>
                </label>
              </div>
            </div>
          </details>
          {repoFilter && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
              Only searching <span className="font-mono text-ink">{repoFilter}</span>
              <Link href={query ? `/search?q=${encodeURIComponent(query)}` : "/search"} className="link">Search everything instead</Link>
            </p>
          )}
        </form>
      </Card>

      <SourcesNotice setup={setup} unreadable={unreadable.length} withoutRepo={projectsWithoutRepo} />

      {matcher?.error && <Notice tone="error" title="Can't run that search">{matcher.error}</Notice>}

      {!query ? (
        <Catalog
          entries={entries}
          infoOf={infoOf}
          refreshHref={qs({ fresh: "1" })}
          ai={aiOn ? { job, missing: missingAi, total: repos.length } : null}
          describe={summarized > 0 ? { readOnly } : null}
          demo={isMockMode()}
        />
      ) : (
        <>
          <p className="text-sm text-ink-2" role="status">
            {[
              scopes.has("projects") && plural(projectHits.length, "project"),
              scopes.has("readme") && `${plural(readmeHits.length, "README")}`,
              scopes.has("code") && `${plural(codeMatches, "code match", "code matches")} in ${plural(code?.results.filter((r) => r.matches.length).length ?? 0, "repo")}`,
            ]
              .filter(Boolean)
              .join(" · ")}{" "}
            for “{query}”
          </p>

          {scopes.has("projects") && (
            <Card className="overflow-hidden">
              <CardHeader title={<span className="flex items-center gap-2">Projects <Badge>{projectHits.length}</Badge></span>} subtitle="Name, description, services, domains, repo, and README summary. Every word must match." />
              {projectHits.length === 0 ? <EmptyState>No project matches.</EmptyState> : <ProjectList entries={projectHits} infoOf={infoOf} o={o} />}
            </Card>
          )}

          {scopes.has("readme") && (
            <Card className="overflow-hidden">
              <CardHeader title={<span className="flex items-center gap-2">READMEs <Badge>{readmeHits.length}</Badge></span>} />
              {readmeHits.length === 0 ? (
                <EmptyState>No README mentions “{query}”.</EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {readmeHits.map((hit) => (
                    <li key={hit.repo} className="px-5 py-3">
                      <RepoHeader repo={hit.repo} info={hit.info} projects={projectsByRepo.get(repoKey(hit.repo)) ?? []} />
                      <ul className="mt-2 space-y-1">
                        {hit.lines.map((l) => (
                          <li key={l.line} className="rounded-md bg-surface-2 px-3 py-1.5 text-xs leading-relaxed">
                            <Highlight text={l.text} o={o} />
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {code && (
            <Card className="overflow-hidden">
              <CardHeader
                title={<span className="flex items-center gap-2">Code <Badge>{codeMatches}</Badge></span>}
                subtitle="Local clones use git grep over tracked and untracked files (lockfiles and .gitignored files skipped). GitHub uses code search on the default branch."
              />
              <div className="space-y-2 px-4 pt-3 empty:hidden">
                {code.error && <Notice tone="error">{code.error}</Notice>}
                {code.notes.map((n) => (
                  <Notice key={n} tone="info">{n}</Notice>
                ))}
              </div>
              {code.results.length === 0 ? (
                <EmptyState>No code matches{code.skipped.length ? ` in the ${plural(repos.length - code.skipped.length, "readable repo")}` : ""}.</EmptyState>
              ) : (
                <ul className="divide-y divide-line">
                  {code.results.map((r) => (
                    <li key={r.repo} className="px-5 py-3">
                      <RepoHeader repo={r.repo} info={infoOf(r.repo)} projects={projectsByRepo.get(repoKey(r.repo)) ?? []} />
                      {r.error && <p className="mt-1 text-xs text-(--status-critical)">{r.error}</p>}
                      <ul className="mt-2 space-y-1">
                        {r.matches.map((m, i) => (
                          <li key={`${m.path}:${m.line}:${i}`} className="overflow-hidden rounded-md bg-surface-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2 px-3 pt-1.5 text-ink-2">
                              {m.url ? (
                                <a href={m.url} target="_blank" rel="noreferrer" className="link font-mono">
                                  {m.path}
                                  {m.line ? `:${m.line}` : ""}
                                </a>
                              ) : (
                                <span className="font-mono">
                                  {m.path}
                                  {m.line ? `:${m.line}` : ""}
                                </span>
                              )}
                            </div>
                            {m.text && (
                              <pre className="overflow-x-auto whitespace-pre px-3 pb-1.5 pt-0.5 font-mono text-[11px] leading-relaxed text-ink">
                                <Highlight text={m.text} o={o} />
                              </pre>
                            )}
                          </li>
                        ))}
                      </ul>
                      {r.truncated && <p className="mt-1 text-xs text-ink-2">More matches not shown — narrow with “File path contains”.</p>}
                    </li>
                  ))}
                </ul>
              )}
              {code.skipped.length > 0 && (
                <p className="border-t border-line px-5 py-2 text-xs text-ink-2">
                  Not searched ({code.skipped.length}): {code.skipped.map((s) => s.repo).join(", ")} — {code.skipped[0].reason}
                </p>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SourcesNotice({ setup, unreadable, withoutRepo }: { setup: Awaited<ReturnType<typeof codeSetup>>; unreadable: number; withoutRepo: number }) {
  if (setup.mock) {
    return (
      <Notice tone="info" title="Demo data">
        READMEs and code here are sample files. Run locally with CODE_LOCAL_ROOTS or a GitHub token to search your own repos.
      </Notice>
    );
  }
  const parts = [
    setup.localRoots.length ? `${plural(setup.clones, "local clone")} under ${setup.localRoots.join(", ")}` : "no local folders (CODE_LOCAL_ROOTS)",
    setup.github ? "GitHub connected (read-only)" : "GitHub not connected",
  ];
  const tone = !setup.github && setup.localRoots.length === 0 ? "warning" : "info";
  return (
    <Notice tone={tone} title={<span className="flex items-center gap-2"><Icon name="code" size={14} /> Code sources: {parts.join(" · ")}</span>}>
      {tone === "warning"
        ? "Add CODE_LOCAL_ROOTS=/path/to/your/code to .env.local, and/or GITHUB_TOKEN (read-only), or sign in with the GitHub CLI (`gh auth login`)."
        : [
            unreadable > 0 && `${plural(unreadable, "repo")} can't be read with the current sources.`,
            withoutRepo > 0 && `${plural(withoutRepo, "project")} deploy from images or templates, not a GitHub repo — only their names, services and domains are searchable.`,
            "Nothing is cloned, pulled or changed.",
          ]
            .filter(Boolean)
            .join(" ")}
    </Notice>
  );
}

function RepoHeader({ repo, info, projects }: { repo: string; info: RepoInfo | undefined; projects: Entry[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <RepoLink repo={repo} />
      <SourceBadge info={info} />
      <span className="text-xs text-ink-2">
        used by{" "}
        {projects.map((e, i) => (
          <span key={e.project.id}>
            {i > 0 && ", "}
            <Link href={e.href} className="font-medium text-ink hover:underline underline-offset-2">
              {e.project.name}
            </Link>
          </span>
        ))}
      </span>
    </div>
  );
}

function About({ entry, infoOf, o }: { entry: Entry; infoOf: (r: string) => Info | undefined; o?: SearchOptions }) {
  const infos = entry.project.repos.map(infoOf).filter((i): i is Info => !!i);
  const ai = infos.find((i) => i.ai?.stored)?.ai;
  if (ai?.stored) {
    const s = ai.stored.summary;
    return (
      <div className="text-xs leading-relaxed">
        <div className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
          {o ? <Highlight text={s.name} o={o} /> : s.name}
          <Badge tone={ai.stale ? "warning" : "info"} title={`Claude summary of ${ai.stored.repo} at ${ai.stored.fingerprint.commit.slice(0, 7)}${ai.stored.fingerprint.dirty ? " + local changes" : ""}, ${ai.stored.generatedAt.slice(0, 10)}. Saved in ${ai.location}`}>
            AI{ai.stale ? " · code changed" : ""}
          </Badge>
        </div>
        <p className="text-ink-2">{o ? <Highlight text={s.summary} o={o} /> : s.summary}</p>
        {s.stack.length + s.services.length > 0 && (
          <p className="mt-0.5 text-[11px] text-ink-2">{[...s.stack, ...s.services.map((x) => `→ ${x}`)].join(" · ")}</p>
        )}
      </div>
    );
  }
  const withReadme = infos.find((i) => i.readme?.summary || i.readme?.title);
  const description = infos.find((i) => i.description)?.description;
  const text = withReadme?.readme?.summary || description || entry.project.description;
  const title = withReadme?.readme?.title;
  const error = infos.find((i) => i.error)?.error;
  if (!text && !title) {
    return (
      <span className="text-xs text-ink-2">
        {error ?? (entry.project.repos.length === 0 ? "No GitHub repo linked." : infos.some((i) => i.source.kind === "none") ? "Repo not readable." : "No README.")}
      </span>
    );
  }
  return (
    <div className="text-xs leading-relaxed">
      {title && <div className="font-medium text-ink">{o ? <Highlight text={title} o={o} /> : title}</div>}
      {text && <p className="text-ink-2">{o ? <Highlight text={text} o={o} /> : text}</p>}
    </div>
  );
}

function ProjectList({ entries, infoOf, o }: { entries: Entry[]; infoOf: (r: string) => Info | undefined; o?: SearchOptions }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-2">
            <th scope="col" className="w-56 px-4 py-2 font-medium">Project</th>
            <th scope="col" className="px-2 py-2 font-medium">What it is</th>
            <th scope="col" className="w-56 px-2 py-2 font-medium">Repo</th>
            <th scope="col" className="w-40 px-4 py-2 font-medium">Services</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.project.id} className="border-b border-line align-top last:border-b-0 hover:bg-surface-2">
              <td className="px-4 py-2.5">
                <Link href={e.href} className="font-medium hover:underline underline-offset-2">
                  {o ? <Highlight text={e.project.name} o={o} /> : e.project.name}
                </Link>
                <div className="text-xs text-ink-2">{e.workspace.name}</div>
              </td>
              <td className="max-w-xl px-2 py-2.5">
                <About entry={e} infoOf={infoOf} o={o} />
              </td>
              <td className="px-2 py-2.5">
                <div className="space-y-1">
                  {e.project.repos.length === 0 && <span className="text-xs text-ink-2">—</span>}
                  {e.project.repos.map((r) => (
                    <div key={r} className="flex flex-wrap items-center gap-1.5">
                      <RepoLink repo={r} />
                      <SourceBadge info={infoOf(r)} />
                    </div>
                  ))}
                </div>
              </td>
              <td className="px-4 py-2.5">
                <HealthSummary counts={e.project.health} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Catalog({
  entries,
  infoOf,
  refreshHref,
  ai,
  describe,
  demo,
}: {
  entries: Entry[];
  infoOf: (r: string) => Info | undefined;
  refreshHref: string;
  ai: { job: SummaryJob; missing: number; total: number } | null;
  /** Shown once at least one repo has a saved summary. */
  describe: { readOnly: boolean } | null;
  demo: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={<span className="flex items-center gap-2">Project catalog <Badge>{entries.length}</Badge></span>}
        subtitle={
          ai
            ? "What each project does, summarized by Claude from its code (saved in each repo, re-run only when the code changes). README summary until then."
            : demo
              ? "What each project does. The demo shows sample summaries; run it locally with ANTHROPIC_API_KEY to summarize your own code."
              : "Every project with a one-line summary from its README. Add ANTHROPIC_API_KEY to .env.local for AI summaries from the code itself."
        }
        actions={
          <>
          {ai && <SummaryControls job={ai.job} missing={ai.missing} total={ai.total} />}
          {describe && !ai?.job.running && <DescribeButton readOnly={describe.readOnly} label="Copy to Railway descriptions" />}
          <Link href={refreshHref} className={buttonClass("ghost")} prefetch={false}>
            <Icon name="refresh" size={12} /> Re-read READMEs
          </Link>
          </>
        }
      />
      {entries.length === 0 ? <EmptyState>No projects match these filters.</EmptyState> : <ProjectList entries={entries} infoOf={infoOf} />}
    </Card>
  );
}
