// One identity per repo, the same in every worktree and from any folder inside it: git's shared .git folder.
// Grow keys line hashes, read commits and the capture start by it, so a line Claude wrote in one checkout is
// still known as Claude's when Grow runs in another.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { run, type Run } from "../pointers/git.js";

export interface RepoIdentity {
  /** The work tree's top folder, where git commands run. Differs between worktrees. */
  top: string;
  /** The repo's identity: the shared .git folder, resolved and normalized. The same for every worktree. */
  key: string;
}

/** Forward slashes, symlinks resolved, and lower case on Windows (its paths ignore case). */
export function normalizeRepoPath(path: string): string {
  let p = resolve(path);
  try {
    p = realpathSync.native(p);
  } catch {
    // A path that cannot be resolved is kept as it is.
  }
  p = p.replaceAll("\\", "/");
  return process.platform === "win32" ? p.toLowerCase() : p;
}

const ARGS = ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"];

function parse(stdout: string): RepoIdentity | null {
  const [top, common] = stdout.trim().split(/\r?\n/);
  return top && common ? { top, key: normalizeRepoPath(common) } : null;
}

export async function repoIdentity(cwd: string, exec: Run = run): Promise<RepoIdentity | null> {
  const result = await exec("git", ARGS, cwd);
  return result.code === 0 ? parse(result.stdout) : null;
}

/** For the hooks: no promise, never throws. */
export function repoIdentitySync(cwd: string): RepoIdentity | null {
  try {
    return parse(execFileSync("git", ARGS, { cwd, encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}
