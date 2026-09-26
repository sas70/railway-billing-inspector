/** Railway's default two-word slug, e.g. steadfast-fascination. */
export function isGeneratedRailwayName(name: string): boolean {
  return /^[a-z]+-[a-z]+$/.test(name.trim());
}
