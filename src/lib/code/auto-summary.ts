/**
 * Which repos to summarize on their own when the app opens: those with no saved summary that this
 * server hasn't already tried since it started. Outdated summaries are left alone here (Search
 * refreshes those), and a repo that failed waits for the next start instead of being retried on
 * every page load.
 */
export function reposToAutoSummarize(repos: string[], savedKeys: ReadonlySet<string>, tried: ReadonlySet<string>): string[] {
  const key = (repo: string) => repo.trim().toLowerCase().replace(/\.git$/, "");
  const out = new Map<string, string>();
  for (const repo of repos) {
    const k = key(repo);
    if (!k || savedKeys.has(k) || tried.has(k) || out.has(k)) continue;
    out.set(k, repo);
  }
  return [...out.values()];
}
