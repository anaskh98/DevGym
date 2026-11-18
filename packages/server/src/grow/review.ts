// PR-time fault review: the AI reads the final change of a pull request and may name a fault, but the server only
// keeps it when the lines really are added in that change and the item exists. A fault in lines Claude wrote is
// "owned" by the developer: they shipped it, so they should have reviewed it.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { parseUnifiedDiff } from "../git/diff.js";
import { repoIdentity } from "../git/identity.js";
import { currentBranch } from "../git/log.js";
import { run, type Run } from "../pointers/git.js";
import { isSupported, symbolAtLine } from "../pointers/symbols.js";
import { aiHashesFor, lineHash, normalizeLine } from "./attribution.js";
import { ticketForCommit } from "./capture.js";
import { ladderForItem } from "./status.js";

export interface ProposeFaultInput {
  item_id: string;
  ladder_id?: string;
  /** The commit the pull request starts from. Left out: the merge base with the default branch. */
  base?: string;
  file: string;
  line_start: number;
  line_end: number;
  why: string;
}

async function mergeBase(top: string, exec: Run): Promise<string | null> {
  for (const ref of ["origin/HEAD", "origin/main", "main", "origin/master", "master"]) {
    const out = await exec("git", ["merge-base", "HEAD", ref], top);
    const sha = out.stdout.trim();
    if (out.code === 0 && sha !== "") return sha;
  }
  return null;
}

/**
 * The base of the pull request. The server works it out (the merge base with the default branch). A base the AI passes is
 * accepted only if it lies on this branch, between where it started and HEAD: the AI must not widen the change to code
 * that is years old or someone else's.
 */
async function pullRequestBase(top: string, given: string | undefined, exec: Run): Promise<string> {
  const mb = await mergeBase(top, exec);
  if (mb === null) throw new StoreError("Could not find where this branch started, so the pull request's change cannot be checked");
  if (given === undefined) return mb;
  const isAncestor = async (a: string, b: string) => (await exec("git", ["merge-base", "--is-ancestor", a, b], top)).code === 0;
  if (!(await isAncestor(mb, given)) || !(await isAncestor(given, "HEAD"))) {
    throw new StoreError("That base is not on this branch between where it started and HEAD. Leave base out: the server finds it");
  }
  return given;
}

/** The added lines of a file between the pull request's base and HEAD, limited to a line range. Throws when none. */
export async function addedLinesInChange(
  top: string,
  base: string | undefined,
  filePath: string,
  lineStart: number,
  lineEnd: number,
  exec: Run,
): Promise<{ path: string; lines: { line: number; text: string }[]; head: string | null }> {
  if (lineEnd < lineStart) throw new StoreError("line_end must not be before line_start");
  const from = await pullRequestBase(top, base, exec);
  const path = filePath.replaceAll("\\", "/");
  const diff = await exec("git", ["diff", "--no-color", "--no-ext-diff", "--text", "--no-textconv", "-U0", "-M", `${from}...HEAD`, "--", path], top);
  if (diff.code !== 0) throw new StoreError(`git diff failed: ${diff.stderr.trim()}`);
  const file = parseUnifiedDiff(diff.stdout).find((f) => f.path === path);
  const lines = (file?.added ?? []).filter((l) => l.line >= lineStart && l.line <= lineEnd);
  if (lines.length === 0) throw new StoreError(`Lines ${lineStart}-${lineEnd} of ${filePath} were not added in this change (${from.slice(0, 7)}...HEAD)`);
  const head = (await exec("git", ["rev-parse", "HEAD"], top)).stdout.trim();
  return { path, lines, head: head === "" ? null : head };
}

export async function proposeFault(
  db: Db,
  root: string,
  input: ProposeFaultInput,
  exec: Run = run,
  home?: string,
): Promise<{ evidence_id: string; owned: boolean }> {
  const identity = await repoIdentity(root, exec);
  if (identity === null) throw new StoreError("This folder is not a git repo");
  const { top, key } = identity;
  const { loaded } = ladderForItem(top, input.item_id, { ...(home ? { home } : {}), ...(input.ladder_id ? { ladderId: input.ladder_id } : {}) });
  if (input.line_end < input.line_start) throw new StoreError("line_end must not be before line_start");

  const found = await addedLinesInChange(top, input.base, input.file, input.line_start, input.line_end, exec);
  const path = found.path;
  const lines = found.lines;

  const ai = aiHashesFor(db, key, path);
  const aiWritten = lines.some((l) => {
    const n = normalizeLine(l.text);
    return n !== null && ai.has(lineHash(n));
  });
  const source = await exec("git", ["show", `HEAD:${path}`], top);
  const symbol = source.code === 0 && isSupported(path) ? ((await symbolAtLine(path, source.stdout, lines[0]!.line))?.name ?? null) : null;
  const head = (await exec("git", ["show", "-s", "--format=%H%x1f%ae%x1f%aI%x1f%s", "HEAD"], top)).stdout.trim().split("\x1f");
  const branch = await currentBranch(top, exec);
  const ticket = ticketForCommit(
    { sha: head[0] ?? "", authorEmail: head[1] ?? "", authorDate: head[2] ?? new Date().toISOString(), subject: head[3] ?? "" },
    { onDefault: false, branch },
  );
  const id = randomUUID();
  db.prepare(
    `INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, owned, repo_root, commit_sha, file_path, symbol, ticket, note, at)
     VALUES (?, ?, ?, 'review', 'negative', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, loaded.ladder_id, input.item_id, aiWritten ? "ai" : "dev", aiWritten ? 1 : 0, key, head[0] ?? null, path, symbol, ticket, input.why, new Date().toISOString());
  return { evidence_id: id, owned: aiWritten };
}
