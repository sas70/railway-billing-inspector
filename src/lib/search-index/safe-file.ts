import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { isIndexableFile } from "./text";

/** Reject symlinks and resolved paths outside the repository before reading code. */
export async function safeIndexFile(root: string, file: string): Promise<string | null> {
  if (!isIndexableFile(file) || path.isAbsolute(file)) return null;
  const base = await realpath(root);
  const full = path.resolve(base, file);
  const inside = (candidate: string) => {
    const relative = path.relative(base, candidate);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  if (!inside(full)) return null;
  // Reject symlinks in any path component, including directory symlinks.
  let current = base;
  for (const part of path.relative(base, full).split(path.sep)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) return null;
  }
  const resolved = await realpath(full);
  return inside(resolved) && isIndexableFile(path.relative(base, resolved)) ? resolved : null;
}
