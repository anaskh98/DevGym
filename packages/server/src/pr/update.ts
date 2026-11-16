// Writes the Decisions section into a pull request's description with the GitHub CLI.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { lookupPr, repoSlug, run, type PrInfo, type PrLookupDeps } from "../pointers/git.js";
import { resolvePointers } from "../pointers/service.js";
import { buildDecisionsSection, mergeSection } from "./section.js";

export interface UpdatePrOptions {
  ticketId: string;
  root: string;
  prNumber?: number | undefined;
  /** Build and return the section without changing the pull request. */
  dryRun?: boolean | undefined;
}

export interface UpdatePrResult {
  ticket_id: string;
  pr: PrInfo | null;
  updated: boolean;
  /** Why the pull request was not changed, when it was not. */
  note: string | null;
  assumptions: number;
  decisions: number;
  pointers: { total: number; resolved: number; broken: number } | null;
  markdown: string;
}

export async function updatePrDecisions(db: Db, options: UpdatePrOptions, deps: PrLookupDeps = {}): Promise<UpdatePrResult> {
  const exec = deps.exec ?? run;
  // Fail early, before touching GitHub, when there is nothing to share.
  buildDecisionsSection(db, options.ticketId);

  const repo = await repoSlug(options.root, exec);
  let pr: PrInfo | null = null;
  let note: string | null = null;
  if (!repo) {
    note = "This folder has no GitHub remote, so no pull request was looked up.";
  } else {
    try {
      pr = await lookupPr(repo, options.prNumber, options.root, deps);
    } catch (err) {
      if (!options.dryRun || !(err instanceof StoreError)) throw err;
      note = err.message; // A preview is still useful without a pull request.
    }
  }

  // Pin the links to the pull request's commit first, so reviewers land on the right code.
  let pointers: UpdatePrResult["pointers"] = null;
  if (pr) {
    try {
      const checked = await resolvePointers(db, { ticketId: options.ticketId, root: options.root, prNumber: pr.number, commit: pr.commit });
      pointers = { total: checked.total, resolved: checked.resolved, broken: checked.broken.length };
    } catch (err) {
      if (!(err instanceof StoreError)) throw err;
      note = `Pointers were not checked: ${err.message}`;
    }
  }

  const section = buildDecisionsSection(db, options.ticketId);
  const result: UpdatePrResult = {
    ticket_id: options.ticketId,
    pr,
    updated: false,
    note,
    assumptions: section.assumptions,
    decisions: section.decisions,
    pointers,
    markdown: section.markdown,
  };
  if (options.dryRun) return { ...result, note: note ?? "Preview only. The pull request was not changed." };
  if (!repo || !pr) throw new StoreError(note ?? "No pull request was found.");

  const view = await exec("gh", ["pr", "view", String(pr.number), "--repo", repo, "--json", "body"], options.root);
  if (view.code === null) {
    throw new StoreError("The GitHub CLI (gh) is not installed, so the pull request cannot be updated. Install it and sign in, or paste the section by hand.");
  }
  if (view.code !== 0) {
    throw new StoreError(`The GitHub CLI could not read the pull request: ${view.stderr.trim().split("\n")[0] ?? "unknown error"}`);
  }
  const body = (JSON.parse(view.stdout) as { body: string | null }).body ?? "";
  const next = mergeSection(body.replace(/\r\n/g, "\n"), section.markdown);

  // The body goes through a file: it is long, and passing it as an argument would need shell escaping.
  const dir = await mkdtemp(join(tmpdir(), "ftc-pr-"));
  try {
    const file = join(dir, "body.md");
    await writeFile(file, next, "utf8");
    const edit = await exec("gh", ["pr", "edit", String(pr.number), "--repo", repo, "--body-file", file], options.root);
    if (edit.code !== 0) {
      throw new StoreError(`The GitHub CLI could not update the pull request: ${edit.stderr.trim().split("\n")[0] ?? "unknown error"}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return { ...result, updated: true };
}
