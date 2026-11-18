// Bugs that reached the main branch and came from the developer's own commits, and mistakes that keep coming back.
// Fix commits are found by their message. git blame on the lines the fix removed names the commit that brought the
// bug in. Rules only: no AI reads a commit. The developer owns what they shipped, whoever typed it.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { commitDiff } from "../git/diff.js";
import { repoIdentity } from "../git/identity.js";
import { defaultBranchCommits, developerEmails, listCommits } from "../git/log.js";
import { run, type Run } from "../pointers/git.js";
import { matchLine } from "../rules/engine.js";
import { targetsBySignal, ticketForCommit } from "./capture.js";
import { toIso } from "./facts.js";
import type { LoadedLadder } from "./ladder/load.js";
import { getExtraEmails } from "./settings.js";
import { SIGNALS } from "./signals.js";

const FIX_WORDS = /\b(fix(es|ed)?|bug(fix)?|hotfix|revert(s|ed)?)\b/i;
const MAX_FIXES_PER_RUN = 50;

export interface BugScan {
  scanned: number;
  found: number;
  remaining: number;
}

/** Who wrote a line when it was last changed before `rev`, from `git blame`: the commit and its author's email. */
async function blameLine(top: string, rev: string, path: string, line: number, exec: Run): Promise<{ sha: string; email: string } | null> {
  const out = await exec("git", ["blame", "--porcelain", "-L", `${line},${line}`, rev, "--", path], top);
  if (out.code !== 0) return null;
  const sha = /^([0-9a-f]{40}) /.exec(out.stdout)?.[1];
  const email = /^author-mail <([^>]*)>/m.exec(out.stdout)?.[1];
  return sha && email ? { sha, email: email.toLowerCase() } : null;
}

export async function scanShippedBugs(db: Db, opts: { root: string; ladders: LoadedLadder[]; now?: Date; exec?: Run }): Promise<BugScan> {
  const exec = opts.exec ?? run;
  const none: BugScan = { scanned: 0, found: 0, remaining: 0 };
  const identity = await repoIdentity(opts.root, exec);
  if (identity === null) return none;
  const { top, key } = identity;
  const emails = await developerEmails(top, getExtraEmails(db), exec);
  if (emails.length === 0) return none;

  const settingKey = `fixes_scanned:${key}`;
  const saved = db.prepare("SELECT value FROM coach_settings WHERE key = ?").get(settingKey) as { value: string } | undefined;
  const scanned = new Set<string>(saved ? (JSON.parse(saved.value) as string[]) : []);
  const onMain = await defaultBranchCommits(top, exec);
  const fixes = (await listCommits(top, { authorEmails: [], anyAuthor: true, exec }))
    .filter((c) => FIX_WORDS.test(c.subject) && (onMain.size === 0 || onMain.has(c.sha)) && !scanned.has(c.sha))
    .reverse(); // newest first
  const batch = fixes.slice(0, MAX_FIXES_PER_RUN);

  const targets = targetsBySignal(opts.ladders);
  const insertBug = db.prepare(
    "INSERT OR IGNORE INTO shipped_bugs (id, repo_root, fix_commit, origin_commit, ladder_id, item_id, signal_id, file_path, symbol, ticket, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
  );
  const insertEvidence = db.prepare(
    `INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, owned, history, repo_root, commit_sha, file_path, ticket, signal_id, at, fixed_at, fixed_ticket, note)
     VALUES (?, ?, ?, 'review', 'negative', 'dev', 1, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'a bug that reached main and was fixed later')`,
  );
  let found = 0;
  for (const fix of batch) {
    scanned.add(fix.sha);
    let diff;
    try {
      diff = await commitDiff(top, fix.sha, exec);
    } catch {
      continue;
    }
    const fixTicket = ticketForCommit(fix, { onDefault: true, branch: null });
    for (const file of diff) {
      if (file.binary) continue;
      for (const removed of file.removed) {
        for (const rule of matchLine(SIGNALS, file.oldPath ?? file.path, removed.text)) {
          const negative = (targets.get(rule.id) ?? []).filter((t) => t.ref.polarity === "negative");
          if (negative.length === 0) continue;
          const origin = await blameLine(top, `${fix.sha}^`, file.oldPath ?? file.path, removed.line, exec);
          if (!origin || !emails.includes(origin.email)) continue; // someone else's bug is not this developer's
          const originInfo = (await exec("git", ["show", "-s", "--format=%aI%x1f%s", origin.sha], top)).stdout.trim().split("\x1f");
          const originTicket = ticketForCommit(
            { sha: origin.sha, authorEmail: origin.email, authorDate: originInfo[0] ?? fix.authorDate, subject: originInfo[1] ?? "" },
            { onDefault: true, branch: null },
          );
          for (const t of negative) {
            const inserted = insertBug.run(randomUUID(), key, fix.sha, origin.sha, t.ladder_id, t.item_id, rule.id, file.path, originTicket, fix.authorDate);
            if (Number(inserted.changes) === 0) continue;
            insertEvidence.run(randomUUID(), t.ladder_id, t.item_id, key, origin.sha, file.path, originTicket, rule.id, originInfo[0] ?? fix.authorDate, fix.authorDate, fixTicket);
            found++;
          }
        }
      }
    }
  }
  db.prepare("INSERT INTO coach_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(settingKey, JSON.stringify([...scanned]));
  return { scanned: batch.length, found, remaining: fixes.length - batch.length };
}

export interface Repeat {
  ladder_id: string;
  item_id: string;
  signal_id: string;
  times: number;
  tickets: number;
  /** How many of them reached the main branch as bugs. */
  shipped: number;
  last_at: string;
  /** False when nothing new came back in the last 60 days: a good sign worth showing. */
  coming_back: boolean;
}

/** The same mistake on 3 or more distinct tickets or weeks, from faults and shipped bugs. Disagreed rows still count. */
export function repeats(db: Db, now: Date = new Date()): Repeat[] {
  const rows = db
    .prepare("SELECT ladder_id, item_id, signal_id, ticket, kind, at FROM skill_evidence WHERE polarity = 'negative' AND signal_id IS NOT NULL ORDER BY at")
    .all() as { ladder_id: string; item_id: string; signal_id: string; ticket: string; kind: string; at: string }[];
  const groups = new Map<string, { ladder_id: string; item_id: string; signal_id: string; tickets: Set<string>; times: number; shipped: number; last: number }>();
  for (const r of rows) {
    const k = `${r.ladder_id}\0${r.item_id}\0${r.signal_id}`;
    const g = groups.get(k) ?? { ladder_id: r.ladder_id, item_id: r.item_id, signal_id: r.signal_id, tickets: new Set<string>(), times: 0, shipped: 0, last: 0 };
    g.tickets.add(r.ticket);
    g.times++;
    if (r.kind === "review") g.shipped++;
    g.last = Math.max(g.last, Date.parse(toIso(r.at)));
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((g) => g.tickets.size >= 3)
    .map((g) => ({
      ladder_id: g.ladder_id,
      item_id: g.item_id,
      signal_id: g.signal_id,
      times: g.times,
      tickets: g.tickets.size,
      shipped: g.shipped,
      last_at: new Date(g.last).toISOString(),
      coming_back: now.getTime() - g.last <= 60 * 86_400_000,
    }))
    .sort((a, b) => Number(b.coming_back) - Number(a.coming_back) || Date.parse(b.last_at) - Date.parse(a.last_at));
}
