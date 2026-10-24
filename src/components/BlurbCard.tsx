import { BLURB_SOURCE_LABEL, type RepoBlurb } from "@/lib/repo-blurb";

const MAX_SHOWN = 3;

/** Hover card body: what the code behind a project or service does. */
export function BlurbCard({ blurbs, description }: { blurbs: RepoBlurb[]; description?: string | null }) {
  if (blurbs.length === 0) {
    if (!description) return null;
    return (
      <div className="space-y-0.5">
        <div className="text-[11px] text-ink-2">Project description on Railway</div>
        <p className="leading-relaxed">{description}</p>
      </div>
    );
  }
  const shown = blurbs.slice(0, MAX_SHOWN);
  return (
    <div className="space-y-2.5">
      {shown.map((blurb) => (
        <div key={blurb.repo} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-semibold">{blurb.name ?? blurb.repo}</span>
            <span className="shrink-0 text-[11px] text-ink-2">{BLURB_SOURCE_LABEL[blurb.source]}</span>
          </div>
          <p className="leading-relaxed text-ink-2">{blurb.text}</p>
          <div className="font-mono text-[11px] text-muted">{[blurb.repo, ...blurb.stack].join(" · ")}</div>
        </div>
      ))}
      {blurbs.length > shown.length && (
        <div className="text-[11px] text-ink-2">+ {blurbs.length - shown.length} more on the project page</div>
      )}
    </div>
  );
}
