import { Icon } from "@/components/Icon";
import { RailwayLink } from "@/components/RailwayLink";
import { railwayProjectUrl } from "@/lib/railway-links";

export function ProjectLinks({
  publicDomains,
  projectId,
}: {
  publicDomains: string[];
  projectId: string;
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
      <RailwayLink href={dashboard} compact />
    </div>
  );
}
