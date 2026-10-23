import { Icon } from "@/components/Icon";
import { RailwayLink } from "@/components/RailwayLink";
import { railwayProjectUrl } from "@/lib/railway-links";

export function ProjectLinks({
  publicDomains,
  projectId,
  repos = [],
}: {
  publicDomains: string[];
  projectId: string;
  repos?: string[];
}) {
  const dashboard = railwayProjectUrl(projectId);
  return (
    <div className="mt-1.5 space-y-0.5 text-xs">
      {publicDomains.map((domain) => (
        <a
          key={domain}
          href={`https://${domain}`}
          target="_blank"
          rel="noreferrer"
          className="link flex items-center gap-1 break-all"
          title="Public Railway domain"
        >
          {domain}
          <Icon name="external" size={10} />
        </a>
      ))}
      {repos.map((repo) => (
        <a
          key={repo}
          href={`https://github.com/${repo}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 break-all font-mono text-ink-2 hover:text-ink"
          title="GitHub repo this project deploys from"
        >
          <Icon name="code" size={10} />
          {repo}
        </a>
      ))}
      <RailwayLink href={dashboard} compact />
    </div>
  );
}
