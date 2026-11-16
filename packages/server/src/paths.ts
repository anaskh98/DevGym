import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Turns a path into a repo-relative path with forward slashes, for example "src/export.ts".
 * Returns null when the path is outside the repo root.
 */
export function toRepoPath(path: string, root: string): string | null {
  const absolute = isAbsolute(path) ? path : resolve(root, path);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

/** Like toRepoPath, but keeps a path outside the root (only tidying its slashes). */
export function tidyPath(path: string, root: string): string {
  return toRepoPath(path, root) ?? path.replaceAll("\\", "/");
}

/** Key for comparing paths: Windows file names ignore case, so we do too. */
export function pathKey(path: string): string {
  return path.replaceAll("\\", "/").toLowerCase();
}
