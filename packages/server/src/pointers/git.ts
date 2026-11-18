// Small wrappers around the git and gh command lines, and the pull request lookup.
import { execFile } from "node:child_process";
import { StoreError } from "../errors.js";

export interface RunResult {
  /** Exit code, or null when the program could not be started (not installed). */
  code: number | null;
  stdout: string;
  stderr: string;
}
export type Run = (command: string, args: string[], cwd: string) => Promise<RunResult>;

export const run: Run = (command, args, cwd) =>
  new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: 30_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const missing = (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
      const code = missing ? null : error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

/** "owner/name" from a GitHub remote URL (https or ssh), or null. */
export function parseRepoSlug(remoteUrl: string): string | null {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s*$/.exec(remoteUrl.trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

export async function repoSlug(root: string, exec: Run = run): Promise<string | null> {
  const result = await exec("git", ["remote", "get-url", "origin"], root);
  return result.code === 0 ? parseRepoSlug(result.stdout) : null;
}

/** The file's text at a commit, or null when the commit or the file is not there. */
export async function fileAtCommit(root: string, commit: string, path: string, exec: Run = run): Promise<string | null> {
  const show = () => exec("git", ["show", `${commit}:${path}`], root);
  let result = await show();
  if (result.code !== 0 && /bad object|unknown revision|invalid object name|not a valid object/i.test(result.stderr)) {
    // A merge commit made on GitHub is not in the local clone until it is fetched.
    await exec("git", ["fetch", "--quiet", "origin"], root);
    result = await show();
  }
  return result.code === 0 ? result.stdout : null;
}

export async function commitExists(root: string, commit: string, exec: Run = run): Promise<boolean> {
  const check = () => exec("git", ["cat-file", "-e", `${commit}^{commit}`], root);
  if ((await check()).code === 0) return true;
  await exec("git", ["fetch", "--quiet", "origin"], root);
  return (await check()).code === 0;
}

export interface PrInfo {
  number: number;
  state: "open" | "merged" | "closed";
  /** The merge commit once merged; otherwise the newest commit on the PR branch. */
  commit: string;
  url: string;
}

export interface PrLookupDeps {
  exec?: Run;
  fetch?: typeof fetch;
}

/**
 * Looks a pull request up with the GitHub CLI. With no number, gh uses the current branch's PR.
 * When gh is not installed and the number is known, it falls back to GitHub's public API,
 * which works for public repositories only.
 */
export async function lookupPr(repo: string, prNumber: number | undefined, root: string, deps: PrLookupDeps = {}): Promise<PrInfo> {
  const exec = deps.exec ?? run;
  const args = ["pr", "view", ...(prNumber ? [String(prNumber)] : []), "--repo", repo, "--json", "number,state,mergeCommit,headRefOid,url"];
  const gh = await exec("gh", args, root);
  if (gh.code === 0) {
    const pr = JSON.parse(gh.stdout) as { number: number; state: string; mergeCommit: { oid: string } | null; headRefOid: string; url: string };
    const merged = pr.state === "MERGED" && pr.mergeCommit !== null;
    return {
      number: pr.number,
      state: merged ? "merged" : pr.state === "OPEN" ? "open" : "closed",
      commit: merged ? (pr.mergeCommit as { oid: string }).oid : pr.headRefOid,
      url: pr.url,
    };
  }
  if (gh.code !== null) {
    throw new StoreError(`The GitHub CLI could not read the pull request: ${gh.stderr.trim().split("\n")[0] ?? "unknown error"}`);
  }
  if (!prNumber) {
    throw new StoreError("The GitHub CLI (gh) is not installed. Install it, or pass pr_number or commit.");
  }
  const response = await (deps.fetch ?? fetch)(`https://api.github.com/repos/${repo}/pulls/${prNumber}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "devgym" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new StoreError(
      `Could not read pull request ${prNumber} of ${repo} (HTTP ${response.status}). For a private repository, install the GitHub CLI (gh) and sign in.`,
    );
  }
  const pr = (await response.json()) as { number: number; state: string; merged: boolean; merge_commit_sha: string | null; head: { sha: string }; html_url: string };
  const merged = pr.merged && pr.merge_commit_sha !== null;
  return {
    number: pr.number,
    state: merged ? "merged" : pr.state === "open" ? "open" : "closed",
    commit: merged ? (pr.merge_commit_sha as string) : pr.head.sha,
    url: pr.html_url,
  };
}
