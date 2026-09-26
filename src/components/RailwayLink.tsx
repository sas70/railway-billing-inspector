import { Icon } from "@/components/Icon";

const linkClass =
  "inline-flex items-center gap-1 font-medium text-[var(--danger)] hover:text-[var(--danger-hover)]";

export function RailwayLink({
  href,
  compact = false,
}: {
  href: string;
  compact?: boolean;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={linkClass} title="Open in Railway">
      <Icon name="railway" size={compact ? 13 : 12} />
      {compact ? <span className="text-xs">Open in Railway</span> : "Open in Railway"}
      {!compact && <Icon name="external" size={11} />}
    </a>
  );
}
