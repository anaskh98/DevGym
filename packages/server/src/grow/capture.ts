// Silent capture: reads the developer's new commits and stores evidence for ladder items.
// No git hook is installed: this catches up on every commit not read yet, whenever Grow runs.
// Only paths, function names, rule ids and commit ids are stored, never code.
import { randomUUID } from "node:crypto";
import { transaction, type Db } from "../db/connection.js";
import { toIso } from "./facts.js";
import { changeId, commitDiff, type FileDiff } from "../git/diff.js";
import { repoIdentity } from "../git/identity.js";
import { currentBranch, defaultBranchCommits, developerEmails, listCommits, type CommitInfo } from "../git/log.js";
import { run, type Run } from "../pointers/git.js";
import { isSupported, symbolAtLine } from "../pointers/symbols.js";
import { matchLine } from "../rules/engine.js";
import { aiHashesFor, firstHashAt, lineHash, normalizeLine, pruneAiLines } from "./attribution.js";
import { DEFAULT_THRESHOLDS, LEVELS, type SignalRef } from "./ladder/schema.js";
import type { LoadedLadder } from "./ladder/load.js";
import { SIGNALS } from "./signals.js";

export interface CatchUpResult {
  started: boolean;
  note?: string;
  commits_read: number;
  evidence_added: number;
  faults_fixed: number;
  more_left: boolean;
  /** Commits still to read after this batch. */
  remaining?: number;
}

export interface CatchUpOptions {
  root: string;
  ladders: LoadedLadder[];
  extraEmails?: string[];
  now?: Date;
  exec?: Run;
  /** Read the developer's older commits (before capture start), one batch per call. Rule hits are marked history. */
  history?: boolean;
}

/** Files that are built, vendored or generated: they say nothing about the developer's skill. */
export function isGeneratedPath(path: string): boolean {
  const p = path.replaceAll("\\", "/").toLowerCase();
  const name = p.split("/").pop() ?? "";
  if (["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "npm-shrinkwrap.json"].includes(name) || name.endsWith(".lock")) return true;
  if (/(^|\/)(dist|build|vendor|node_modules|__generated__)\//.test(p)) return true;
  return /\.min\.[a-z0-9]+$/.test(name) || /\.generated\.[a-z0-9]+$/.test(name);
}

const MAX_ADDED_LINES = 3000;

/** ISO 8601 week, for example "2026-W46", from the date part of an ISO timestamp. */
function isoWeek(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day + 3); // the Thursday of this week decides its year
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Words that look like ticket keys but are not: UTF-8, SHA-256, HTTP-2, ISO-8601, RFC-9110... */
const NOT_TICKETS = new Set(["UTF", "SHA", "HTTP", "ISO", "RFC", "TLS", "SSL", "MD", "AES", "RSA", "CVE", "ES", "IPV", "H", "X", "TS", "PEP", "JSR"]);

/** The ticket a commit belongs to: a key in its subject, else the branch it was made on, else its calendar week. */
export function ticketForCommit(c: CommitInfo, ctx: { onDefault: boolean; branch: string | null }): string {
  for (const match of c.subject.matchAll(/\b([A-Z][A-Z0-9]+)-\d+\b/g)) {
    if (!NOT_TICKETS.has(match[1]!)) return match[0];
  }
  const branch = c.source ?? ctx.branch;
  if (!ctx.onDefault && branch) return branch;
  return `week:${isoWeek(c.authorDate)}`;
}

/** A file at a commit, without fetching. Null when it is not there (a root commit's parent, a new file). */
async function showFile(root: string, rev: string, path: string, exec: Run): Promise<string | null> {
  const result = await exec("git", ["show", `${rev}:${path}`], root);
  return result.code === 0 ? result.stdout : null;
}

interface Target {
  ladder_id: string;
  item_id: string;
  ref: SignalRef;
}

/** For each signal id: the ladder items that use it. */
export function targetsBySignal(ladders: LoadedLadder[]): Map<string, Target[]> {
  const map = new Map<string, Target[]>();
  for (const l of ladders) {
    for (const area of l.ladder.areas) {
      for (const level of LEVELS) {
        for (const item of area.levels[level]) {
          for (const ref of item.signals) {
            const list = map.get(ref.id) ?? [];
            list.push({ ladder_id: l.ladder_id, item_id: item.id, ref });
            map.set(ref.id, list);
          }
        }
      }
    }
  }
  return map;
}

/** For each exposure signal id: the ladder items it shows a chance for. */
function exposureBySignal(ladders: LoadedLadder[]): Map<string, { ladder_id: string; item_id: string }[]> {
  const map = new Map<string, { ladder_id: string; item_id: string }[]>();
  for (const l of ladders) {
    for (const area of l.ladder.areas) {
      for (const level of LEVELS) {
        for (const item of area.levels[level]) {
          for (const id of item.exposure_signals ?? []) {
            const list = map.get(id) ?? [];
            list.push({ ladder_id: l.ladder_id, item_id: item.id });
            map.set(id, list);
          }
        }
      }
    }
  }
  return map;
}

interface ExposureRow {
  ladder_id: string;
  item_id: string;
  file_path: string;
  symbol: string | null;
  signal_id: string;
}

async function symbolsFor(path: string, source: string | null, lines: number[]): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  for (const line of lines) {
    out.set(line, source !== null && isSupported(path) ? ((await symbolAtLine(path, source, line))?.name ?? null) : null);
  }
  return out;
}

interface NewRow {
  ladder_id: string;
  item_id: string;
  polarity: "positive" | "negative";
  author: "ai" | "dev";
  regresses: boolean;
  file_path: string;
  symbol: string | null;
  signal_id: string;
}

interface Fix {
  signal_id: string;
  file_path: string;
  symbol: string | null;
}

async function readCommit(
  db: Db,
  top: string,
  repoKey: string,
  sha: string,
  diff: FileDiff[],
  targets: Map<string, Target[]>,
  exposureTargets: Map<string, { ladder_id: string; item_id: string }[]>,
  exec: Run,
): Promise<{ rows: NewRow[]; fixes: Fix[]; exposure: ExposureRow[] }> {
  const rows = new Map<string, NewRow>();
  const fixes = new Map<string, Fix>();
  const exposure = new Map<string, ExposureRow>();
  for (const file of diff) {
    if (file.binary || isGeneratedPath(file.path) || file.added.length > MAX_ADDED_LINES) continue;

    // Added lines: evidence for or against items.
    const hits: { line: number; text: string; signal: string }[] = [];
    // Exposure: a chance to use a skill, whoever wrote the line (the task needed the skill either way).
    const chances: { line: number; signal: string }[] = [];
    for (const added of file.added) {
      for (const rule of matchLine(SIGNALS, file.path, added.text)) {
        if (targets.has(rule.id)) hits.push({ ...added, signal: rule.id });
        if (exposureTargets.has(rule.id)) chances.push({ line: added.line, signal: rule.id });
      }
    }
    const symbols =
      hits.length > 0 || chances.length > 0
        ? await symbolsFor(file.path, await showFile(top, sha, file.path, exec), [...new Set([...hits, ...chances].map((h) => h.line))])
        : new Map<number, string | null>();
    for (const chance of chances) {
      const symbol = symbols.get(chance.line) ?? null;
      for (const t of exposureTargets.get(chance.signal) ?? []) {
        const key = [t.ladder_id, t.item_id, chance.signal, file.path, symbol ?? ""].join("\0");
        if (!exposure.has(key)) exposure.set(key, { ...t, file_path: file.path, symbol, signal_id: chance.signal });
      }
    }
    if (hits.length > 0) {
      const ai = aiHashesFor(db, repoKey, file.path);
      for (const hit of hits) {
        const normalized = normalizeLine(hit.text);
        const author = normalized !== null && ai.has(lineHash(normalized)) ? "ai" : "dev";
        const symbol = symbols.get(hit.line) ?? null;
        for (const t of targets.get(hit.signal) ?? []) {
          const key = [t.ladder_id, t.item_id, hit.signal, file.path, symbol ?? "", author].join("\0");
          if (!rows.has(key)) {
            rows.set(key, {
              ladder_id: t.ladder_id,
              item_id: t.item_id,
              polarity: t.ref.polarity,
              author,
              regresses: t.ref.regresses === true,
              file_path: file.path,
              symbol,
              signal_id: hit.signal,
            });
          }
        }
      }
    }

    // Removed lines: a removed negative signal fixes an open fault in the same function.
    const removedHits: { line: number; signal: string }[] = [];
    for (const removed of file.removed) {
      for (const rule of matchLine(SIGNALS, file.path, removed.text)) {
        if ((targets.get(rule.id) ?? []).some((t) => t.ref.polarity === "negative")) removedHits.push({ line: removed.line, signal: rule.id });
      }
    }
    if (removedHits.length > 0) {
      const oldPath = file.oldPath ?? file.path;
      const source = await showFile(top, `${sha}^`, oldPath, exec);
      const symbols = await symbolsFor(oldPath, source, [...new Set(removedHits.map((h) => h.line))]);
      for (const hit of removedHits) {
        const fix = { signal_id: hit.signal, file_path: file.path, symbol: symbols.get(hit.line) ?? null };
        fixes.set([fix.signal_id, fix.file_path, fix.symbol ?? ""].join("\0"), fix);
      }
    }
  }
  return { rows: [...rows.values()], fixes: [...fixes.values()], exposure: [...exposure.values()] };
}

/** The moment capture starts in a repo: Claude's first edit there, saved once. Null before any edit. */
function captureStart(db: Db, repoKey: string): string | null {
  const key = `capture_start:${repoKey}`;
  const saved = db.prepare("SELECT value FROM coach_settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (saved) return JSON.parse(saved.value) as string;
  const first = firstHashAt(db, repoKey);
  if (first !== null) db.prepare("INSERT INTO coach_settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(first));
  return first;
}

/** A review fault has no signal to match, so it is closed when a later commit removes lines from the same function. */
async function closeReviewFaults(db: Db, top: string, key: string, sha: string, diff: FileDiff[], ticket: string, at: string, exec: Run): Promise<void> {
  const open = db.prepare("SELECT id, file_path, symbol, at FROM skill_evidence WHERE repo_root = ? AND kind IN ('review', 'ticket_check') AND signal_id IS NULL AND polarity = 'negative' AND file_path IS NOT NULL AND fixed_at IS NULL");
  const close = db.prepare("UPDATE skill_evidence SET fixed_at = ?, fixed_ticket = ? WHERE id = ?");
  // Times come in two formats (UTC "Z" and a local offset), so they are compared as moments, never as text.
  const faults = (open.all(key) as { id: string; file_path: string; symbol: string | null; at: string }[]).filter((f) => Date.parse(toIso(f.at)) < Date.parse(at));
  for (const file of diff) {
    const mine = faults.filter((f) => f.file_path === file.path || f.file_path === file.oldPath);
    if (mine.length === 0 || file.removed.length === 0) continue;
    const source = await showFile(top, `${sha}^`, file.oldPath ?? file.path, exec);
    const symbols = new Set((await symbolsFor(file.oldPath ?? file.path, source, file.removed.map((l) => l.line))).values());
    for (const f of mine) if (f.symbol === null || symbols.has(f.symbol)) close.run(at, ticket, f.id);
  }
}

export async function catchUp(db: Db, opts: CatchUpOptions): Promise<CatchUpResult> {
  const exec = opts.exec ?? run;
  const now = opts.now ?? new Date();
  const t = opts.ladders[0]?.thresholds ?? DEFAULT_THRESHOLDS;
  const nothing = (note?: string): CatchUpResult => ({
    started: note === undefined,
    ...(note === undefined ? {} : { note }),
    commits_read: 0,
    evidence_added: 0,
    faults_fixed: 0,
    more_left: false,
    remaining: 0,
  });

  const identity = await repoIdentity(opts.root, exec);
  if (identity === null) return nothing("This folder is not a git repo, so Grow has no commits to read.");
  // Git commands run in this work tree; the database keys everything by the repo, the same for every worktree.
  const { top, key } = identity;
  const emails = await developerEmails(top, opts.extraEmails ?? [], exec);
  if (emails.length === 0) return nothing("No git user.email is set, so Grow can't tell which commits are yours.");
  // Where capture starts in this repo is remembered, so cleaning up old hashes never stops it.
  const since = captureStart(db, key);
  pruneAiLines(db, t.hash_keep_days, now);
  const history = opts.history === true;
  if (since === null && !history) return nothing("Grow starts reading commits after Claude's first edit in this repo.");

  const seen = new Set((db.prepare("SELECT sha FROM commits_seen WHERE repo_root = ?").all(key) as { sha: string }[]).map((r) => r.sha));
  // History mode reads what came before capture start; the normal mode reads from capture start on.
  const listed = await listCommits(top, { authorEmails: emails, ...(history || since === null ? {} : { sinceIso: since }), exec });
  const wanted = history && since !== null ? listed.filter((c) => Date.parse(c.authorDate) < Date.parse(since)) : listed;
  const unseen = wanted.filter((c) => !seen.has(c.sha));
  const batch = unseen.slice(0, t.catchup_max);
  if (batch.length === 0) return nothing();

  const onDefault = await defaultBranchCommits(top, exec);
  const branch = await currentBranch(top, exec);
  const targets = targetsBySignal(opts.ladders);
  const exposureTargets = exposureBySignal(opts.ladders);
  const insertExposure = db.prepare(
    "INSERT INTO skill_exposure (id, ladder_id, item_id, repo_root, commit_sha, file_path, symbol, ticket, signal_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const sameChange = db.prepare("SELECT 1 FROM commits_seen WHERE repo_root = ? AND change_id = ?");
  const markSeenStmt = db.prepare("INSERT OR IGNORE INTO commits_seen (repo_root, sha, change_id, history) VALUES (?, ?, ?, ?)");
  const markSeen = { run: (k: string, sha: string, id: string) => markSeenStmt.run(k, sha, id, history ? 1 : 0) };
  const insert = db.prepare(`
    INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, regresses, repo_root, commit_sha, file_path, symbol, ticket, signal_id, at, history)
    VALUES (?, ?, ?, 'rule', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const fix = db.prepare(`
    UPDATE skill_evidence SET fixed_at = ?, fixed_ticket = ?
    WHERE repo_root = ? AND polarity = 'negative' AND fixed_at IS NULL AND signal_id = ? AND file_path = ? AND symbol IS ? AND at < ?`);

  let evidenceAdded = 0;
  let faultsFixed = 0;
  for (const c of batch) {
    let diff: FileDiff[];
    try {
      diff = await commitDiff(top, c.sha, exec);
    } catch {
      // A commit git cannot show (too big, broken) is marked read and skipped, so it never blocks later commits.
      markSeen.run(key, c.sha, `skipped:${c.sha}`);
      continue;
    }
    const id = changeId(diff);
    if (sameChange.get(key, id)) {
      markSeen.run(key, c.sha, id); // The same change was read already, under another commit id.
      continue;
    }
    const ticket = ticketForCommit(c, { onDefault: onDefault.has(c.sha), branch });
    let found: { rows: NewRow[]; fixes: Fix[]; exposure: ExposureRow[] };
    try {
      found = await readCommit(db, top, key, c.sha, diff, targets, exposureTargets, exec);
    } catch {
      markSeen.run(key, c.sha, id);
      continue;
    }
    const { rows, fixes, exposure } = found;
    try {
      await closeReviewFaults(db, top, key, c.sha, diff, ticket, c.authorDate, exec);
    } catch {
      // Closing faults is best effort: the commit's own evidence is still saved.
    }
    transaction(db, () => {
      // Claim the commit first: another run (the background worker and /grow can overlap) may have read it already.
      if (Number(markSeen.run(key, c.sha, id).changes) === 0) return;
      for (const r of rows) {
        insert.run(randomUUID(), r.ladder_id, r.item_id, r.polarity, r.author, r.regresses ? 1 : 0, key, c.sha, r.file_path, r.symbol, ticket, r.signal_id, c.authorDate, history ? 1 : 0);
        evidenceAdded++;
      }
      for (const x of exposure) insertExposure.run(randomUUID(), x.ladder_id, x.item_id, key, c.sha, x.file_path, x.symbol, ticket, x.signal_id, c.authorDate);
      for (const f of fixes) faultsFixed += Number(fix.run(c.authorDate, ticket, key, f.signal_id, f.file_path, f.symbol, c.authorDate).changes);
    });
  }
  return { started: true, commits_read: batch.length, evidence_added: evidenceAdded, faults_fixed: faultsFixed, more_left: unseen.length > batch.length, remaining: unseen.length - batch.length };
}
