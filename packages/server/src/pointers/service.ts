// The pointer service. A pointer says where a decision lives: repo, file, function, commit.
// It never holds code. This file fills pointers in when a decision is logged, and later
// moves them to the merge commit and checks that each one still finds its code.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { tidyPath, toRepoPath } from "../paths.js";
import { commitExists, fileAtCommit, lookupPr, repoSlug, run, type PrInfo, type PrLookupDeps, type Run } from "./git.js";
import { findSymbol, isSupported, symbolAtLine } from "./symbols.js";

export interface PointerDraft {
  repo: string;
  file_path: string;
  symbol?: string | undefined;
  line_hint?: number | undefined;
  pr_number?: number | undefined;
  commit?: string | undefined;
}

/**
 * Called when a decision is logged. The server works out what it can see for itself:
 * the repo from the git remote, and the function name from the line.
 * It never fails: anything it cannot work out stays as the caller sent it.
 */
export async function enrichPointer<T extends PointerDraft>(pointer: T, root: string, exec: Run = run): Promise<T> {
  const out = { ...pointer, file_path: tidyPath(pointer.file_path, root) };
  try {
    out.repo = (await repoSlug(root, exec)) ?? pointer.repo;
    const repoPath = toRepoPath(pointer.file_path, root);
    if (repoPath === null || !isSupported(repoPath)) return out;
    const source = await readFile(resolve(root, repoPath), "utf8");
    if (pointer.line_hint) {
      // The line is what the caller saw. The function around it is the lasting anchor.
      const found = await symbolAtLine(repoPath, source, pointer.line_hint);
      if (found) out.symbol = found.name;
    } else if (pointer.symbol) {
      const found = await findSymbol(repoPath, source, pointer.symbol);
      if (found) {
        out.symbol = found.name;
        out.line_hint = found.startLine;
      }
    }
  } catch {
    // The file may not exist yet, or may not parse. Keep what we were given.
  }
  return out;
}

export interface BrokenPointer {
  pointer_id: string;
  decision_id: string;
  file_path: string;
  symbol: string | null;
  reason: string;
}

export interface ResolveResult {
  ticket_id: string;
  repo: string | null;
  commit: string;
  pr: PrInfo | null;
  total: number;
  resolved: number;
  broken: BrokenPointer[];
}

export interface ResolveOptions {
  ticketId: string;
  root: string;
  /** Check against this commit. When left out, the pull request decides the commit. */
  commit?: string | undefined;
  prNumber?: number | undefined;
}

/**
 * Moves every pointer of a ticket to one commit and checks it there.
 * After a squash merge the branch commits are gone, so the commit is the merge commit:
 * the pull request tells us which one. A pointer "resolves" when its file exists at that
 * commit and, if it names a function, the function is still in the file.
 */
export async function resolvePointers(db: Db, options: ResolveOptions, deps: PrLookupDeps = {}): Promise<ResolveResult> {
  const exec = deps.exec ?? run;
  const pointers = db
    .prepare(
      `SELECT p.id, p.repo, p.pr_number, p.file_path, p.symbol, d.id AS decision_id
       FROM pointers p JOIN decisions d ON d.pointer_id = p.id
       WHERE d.ticket_id = ? ORDER BY d.rowid`,
    )
    .all(options.ticketId) as { id: string; repo: string; pr_number: number | null; file_path: string; symbol: string | null; decision_id: string }[];
  if (!db.prepare("SELECT 1 FROM tickets WHERE id = ?").get(options.ticketId)) {
    throw new StoreError(`Ticket '${options.ticketId}' does not exist`);
  }

  const repo = (await repoSlug(options.root, exec)) ?? pointers.find((p) => p.repo.includes("/"))?.repo ?? null;
  let commit = options.commit;
  let pr: PrInfo | null = null;
  if (!commit) {
    if (!repo) throw new StoreError("This folder has no GitHub remote, so the pull request cannot be found. Pass commit instead.");
    const known = options.prNumber ?? pointers.find((p) => p.pr_number !== null)?.pr_number ?? undefined;
    pr = await lookupPr(repo, known, options.root, deps);
    commit = pr.commit;
  }
  if (!(await commitExists(options.root, commit, exec))) {
    throw new StoreError(`Commit ${commit} is not in this clone, even after fetching. Pull the latest changes and try again.`);
  }

  const update = db.prepare(
    `UPDATE pointers SET repo = ?, commit_sha = ?, pr_number = ?, line_hint = COALESCE(?, line_hint),
            resolved = ?, resolved_at = datetime('now'), resolve_note = ? WHERE id = ?`,
  );
  const broken: BrokenPointer[] = [];
  for (const p of pointers) {
    let reason: string | null = null;
    let line: number | null = null;
    const source = await fileAtCommit(options.root, commit, p.file_path, exec);
    if (source === null) {
      reason = "The file does not exist at this commit";
    } else if (p.symbol && isSupported(p.file_path)) {
      const found = await findSymbol(p.file_path, source, p.symbol);
      if (found) line = found.startLine;
      else reason = `'${p.symbol}' is no longer in the file`;
    }
    update.run(repo ?? p.repo, commit, pr?.number ?? options.prNumber ?? p.pr_number, line, reason === null ? 1 : 0, reason, p.id);
    if (reason !== null) {
      broken.push({ pointer_id: p.id, decision_id: p.decision_id, file_path: p.file_path, symbol: p.symbol, reason });
    }
  }
  return { ticket_id: options.ticketId, repo, commit, pr, total: pointers.length, resolved: pointers.length - broken.length, broken };
}
