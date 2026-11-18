// Reads git history: the developer's commits, the current branch, and what is already on the default branch.
import { run, type Run } from "../pointers/git.js";

export interface CommitInfo {
  sha: string;
  authorEmail: string;
  /** ISO 8601 with the author's offset, for example 2026-11-10T10:00:00+02:00. */
  authorDate: string;
  subject: string;
  /** The local branch git reached this commit from, for example "feature/retry". */
  source?: string;
}

const SEP = "\x1f";

export async function isGitRepo(root: string, exec: Run = run): Promise<boolean> {
  const result = await exec("git", ["rev-parse", "--is-inside-work-tree"], root);
  return result.code === 0 && result.stdout.trim() === "true";
}

/** The repo's top folder as git prints it (forward slashes), or null outside a repo. */
export async function repoTopLevel(cwd: string, exec: Run = run): Promise<string | null> {
  const result = await exec("git", ["rev-parse", "--show-toplevel"], cwd);
  return result.code === 0 && result.stdout.trim() !== "" ? result.stdout.trim() : null;
}

export async function currentBranch(root: string, exec: Run = run): Promise<string | null> {
  const result = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const name = result.stdout.trim();
  return result.code === 0 && name !== "" && name !== "HEAD" ? name : null;
}

/** The developer's emails: git config user.email plus extra ones, lowercased, no repeats. */
export async function developerEmails(root: string, extra: string[], exec: Run = run): Promise<string[]> {
  const result = await exec("git", ["config", "user.email"], root);
  const own = result.code === 0 ? [result.stdout.trim()] : [];
  return [...new Set([...own, ...extra].map((e) => e.trim().toLowerCase()).filter((e) => e !== ""))];
}

/** The developer's commits on local branches, oldest first. Merge commits are left out. */
export async function listCommits(
  root: string,
  opts: { authorEmails: string[]; sinceIso?: string; exec?: Run },
): Promise<CommitInfo[]> {
  const exec = opts.exec ?? run;
  // --source names the branch each commit was reached from, so its ticket does not depend on what is checked out now.
  const args = ["log", "--branches", "--source", "--no-merges", `--format=%H${SEP}%ae${SEP}%aI${SEP}%S${SEP}%s`];
  if (opts.sinceIso) args.push(`--since=${opts.sinceIso}`);
  const result = await exec("git", args, root);
  if (result.code !== 0) return []; // An empty repo has no commits to log.
  const emails = new Set(opts.authorEmails.map((e) => e.toLowerCase()));
  return result.stdout
    .split("\n")
    .filter((line) => line.includes(SEP))
    .map((line) => {
      const [sha = "", authorEmail = "", authorDate = "", source = "", ...subject] = line.split(SEP);
      const branch = source.replace(/^refs\/heads\//, "");
      return { sha, authorEmail: authorEmail.toLowerCase(), authorDate, subject: subject.join(SEP), ...(branch ? { source: branch } : {}) };
    })
    .filter((c) => emails.has(c.authorEmail))
    .reverse();
}

/** Every commit on the default branch (origin/HEAD, else main, else master). Empty when there is none. */
export async function defaultBranchCommits(root: string, exec: Run = run): Promise<Set<string>> {
  for (const ref of ["origin/HEAD", "main", "master"]) {
    const found = await exec("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
    if (found.code !== 0) continue;
    const list = await exec("git", ["rev-list", ref], root);
    if (list.code === 0) return new Set(list.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
  }
  return new Set();
}
