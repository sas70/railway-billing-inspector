import "server-only";

import type { RepoBlurb } from "../repo-blurb";
import { savedSummaries } from "./ai-summary";
import { offlineRepoInfo } from "./index";
import { mapLimit, repoKey } from "./sources";

/**
 * A short "what is this" per repo for the hover cards on Overview and Services: the saved Claude
 * summary when there is one, otherwise the README of a local clone (or the demo data). Reads local
 * files only, so the list pages never wait on GitHub or Claude. A repo that exists only on GitHub
 * and has no saved summary gets no card.
 */
export async function repoBlurbs(repos: string[]): Promise<Map<string, RepoBlurb>> {
  const unique = [...new Map(repos.filter(Boolean).map((r) => [repoKey(r), r])).values()];
  const out = new Map<string, RepoBlurb>();
  if (unique.length === 0) return out;

  const saved = await savedSummaries(unique);
  await mapLimit(unique, 8, async (repo) => {
    const key = repoKey(repo);
    const ai = saved.get(key)?.summary;
    if (ai && ai.summary.trim()) {
      out.set(key, { repo, name: ai.name.trim() || null, text: ai.summary.trim(), source: "ai", stack: ai.stack.slice(0, 4) });
      return;
    }
    const info = await offlineRepoInfo(repo);
    const readme = info?.readme?.summary.trim();
    if (readme) {
      out.set(key, { repo, name: info?.readme?.title ?? null, text: readme, source: "readme", stack: [] });
      return;
    }
    const description = info?.description?.trim();
    if (description) out.set(key, { repo, name: null, text: description, source: "description", stack: [] });
  });
  return out;
}
