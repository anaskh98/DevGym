import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { scanShippedBugs, repeats } from "./bugs.js";
import { loadActiveLadders, type LoadedLadder } from "./ladder/load.js";
import { repoIdentitySync } from "../git/identity.js";

let db: Db;
let dir: string;
let repo: string;
let ladders: LoadedLadder[];
const NOW = new Date("2026-11-18T12:00:00Z");

function git(args: string[], env: Record<string, string> = {}) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}
function commit(files: Record<string, string>, message: string, email: string, date: string) {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(repo, p, ".."), { recursive: true });
    writeFileSync(join(repo, p), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], { GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}
const BAD = "export async function save() {\n  try { await write(); } catch (e) {}\n}\n";
const GOOD = "export async function save() {\n  await write();\n}\n";

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  dir = mkdtempSync(join(tmpdir(), "ftc-bugs-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
  ladders = loadActiveLadders(["backend"], { repoRoot: repo, home: dir });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("scanShippedBugs", () => {
  it("finds a bug the developer shipped that someone else fixed, and counts it as a fault", async () => {
    commit({ "src/a.ts": BAD }, "PAY-1 save", "dev@example.com", "2026-09-01T10:00:00Z");
    commit({ "src/a.ts": GOOD }, "fix: do not hide the write error", "other@example.com", "2026-10-01T10:00:00Z");
    const out = await scanShippedBugs(db, { root: repo, ladders, now: NOW });
    expect(out).toMatchObject({ scanned: 1, found: 1 });
    const bug = db.prepare("SELECT item_id, signal_id, file_path FROM shipped_bugs").get() as Record<string, unknown>;
    expect(bug).toMatchObject({ item_id: "BE.ERR.J1", signal_id: "err.empty-catch", file_path: "src/a.ts" });
    const ev = db.prepare("SELECT kind, polarity, author, history FROM skill_evidence WHERE kind = 'review'").get();
    expect(ev).toMatchObject({ kind: "review", polarity: "negative", author: "dev", history: 1 });
  });

  it("ignores a bug that someone else introduced (Review Focus 4)", async () => {
    commit({ "src/a.ts": BAD }, "PAY-1 save", "other@example.com", "2026-09-01T10:00:00Z");
    commit({ "src/a.ts": GOOD }, "fix: do not hide the write error", "dev@example.com", "2026-10-01T10:00:00Z");
    expect(await scanShippedBugs(db, { root: repo, ladders, now: NOW })).toMatchObject({ scanned: 1, found: 0 });
  });

  it("reads each fix commit once", async () => {
    commit({ "src/a.ts": BAD }, "PAY-1 save", "dev@example.com", "2026-09-01T10:00:00Z");
    commit({ "src/a.ts": GOOD }, "hotfix the swallowed error", "other@example.com", "2026-10-01T10:00:00Z");
    await scanShippedBugs(db, { root: repo, ladders, now: NOW });
    expect(await scanShippedBugs(db, { root: repo, ladders, now: NOW })).toMatchObject({ scanned: 0, found: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM shipped_bugs").get()).toEqual({ n: 1 });
  });

  it("skips commits that do not look like fixes", async () => {
    commit({ "src/a.ts": BAD }, "PAY-1 save", "dev@example.com", "2026-09-01T10:00:00Z");
    commit({ "src/a.ts": GOOD }, "tidy up the module", "other@example.com", "2026-10-01T10:00:00Z");
    expect(await scanShippedBugs(db, { root: repo, ladders, now: NOW })).toMatchObject({ scanned: 0 });
  });
});

describe("repeats", () => {
  function fault(item: string, signal: string, ticket: string, at: string) {
    db.prepare("INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (lower(hex(randomblob(8))), 'builtin/backend', ?, 'rule', 'negative', 'dev', ?, ?, 'a.ts', lower(hex(randomblob(2))), ?)").run(item, ticket, signal, at);
  }
  it("groups the same mistake on 3 or more tickets as a repeat, newest first", () => {
    fault("BE.ERR.J1", "err.empty-catch", "T-1", "2026-09-01T10:00:00Z");
    fault("BE.ERR.J1", "err.empty-catch", "T-2", "2026-10-01T10:00:00Z");
    fault("BE.ERR.J1", "err.empty-catch", "T-3", "2026-11-01T10:00:00Z");
    fault("BE.ERR.M3", "err.error-leak", "T-1", "2026-11-02T10:00:00Z");
    fault("BE.ERR.M3", "err.error-leak", "T-1", "2026-11-03T10:00:00Z");
    const r = repeats(db, NOW);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ item_id: "BE.ERR.J1", signal_id: "err.empty-catch", times: 3, tickets: 3, shipped: 0, coming_back: true });
  });
  it("calls a repeat with nothing new in 60 days a fixed habit", () => {
    for (const [i, t] of ["T-1", "T-2", "T-3"].entries()) fault("BE.ERR.J1", "err.empty-catch", t, `2026-0${i + 1}-01T10:00:00Z`);
    expect(repeats(db, NOW)[0]).toMatchObject({ coming_back: false });
  });
});
