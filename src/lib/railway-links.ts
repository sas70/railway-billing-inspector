/** Official Railway dashboard URL for a project (opens that project, any workspace). */
export function railwayProjectUrl(projectId: string): string {
  return `https://railway.com/project/${projectId}`;
}

/** Official Railway dashboard URL for one service in a project. */
export function railwayServiceUrl(projectId: string, serviceId: string, environmentId?: string): string {
  const url = `https://railway.com/project/${projectId}/service/${serviceId}`;
  return environmentId ? `${url}?environmentId=${environmentId}` : url;
}

/** Prefer Railway-assigned *.up.railway.app hosts, then custom domains. */
export function pickPublicDomains(domains: string[], limit = 2): string[] {
  const unique = [...new Set(domains.map((d) => d.trim()).filter(Boolean))];
  const assigned = unique.filter((d) => d.endsWith(".up.railway.app") || d.endsWith(".railway.app"));
  const custom = unique.filter((d) => !assigned.includes(d));
  return [...assigned, ...custom].slice(0, limit);
}

export function instanceDomains(domains?: { serviceDomains: { domain: string }[]; customDomains: { domain: string }[] }): string[] {
  if (!domains) return [];
  return [...domains.serviceDomains, ...domains.customDomains].map((d) => d.domain);
}
