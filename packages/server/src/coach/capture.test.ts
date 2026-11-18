import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { saveAiLines } from "./attribution.js";
import { catchUp, isGeneratedPath, ticketForCommit } from "./capture.js";
import { loadActiveLadders, type LoadedLadder } from "./ladder/load.js";
import type { Run } from "../pointers/git.js";

let db: Db;
let dir: string;
let repo: string;
let top: string;
let ladders: LoadedLadder[];
const NOW = new Date("2026-11-18T12:00:00Z");

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}
function commit(files: Record<string, string>, message: string, date = "2026-11-10T10:00:00Z", email = "dev@example.com"): string {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], { GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_NAME: "A", GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(["rev-parse", "HEAD"]);
}
function evidence() {
  return db
    .prepare("SELECT ladder_id, item_id, signal_id, polarity, author, file_path, symbol, ticket, fixed_ticket FROM skill_evidence ORDER BY at, item_id, signal_id")
    .all()
    .map((r) => ({ ...r })) as Record<string, unknown>[];
}
/** Marks that Claude edited in this repo before the commits, so capture starts. */
function startCapture() {
  db.prepare("INSERT INTO ai_line_hashes (repo_root, file_path, hash, session_id, created_at) VALUES (?, 'x', 'seed', 's0', '2026-11-01 00:00:00')").run(top);
}

const PAY = (body: string) => `export async function charge(url: string) {\n${body}\n}\n`;
const TIMEOUT_LINE = "  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });";

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  dir = mkdtempSync(join(tmpdir(), "ftc-capture-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
  top = git(["rev-parse", "--show-toplevel"]);
  ladders = loadActiveLadders(["backend", "frontend"], { repoRoot: repo, home: dir });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("catchUp", () => {
  it("adds a positive proof from a developer line, with the enclosing function", async () => {
    startCapture();
    commit({ "src/pay.ts": PAY(TIMEOUT_LINE) }, "PAY-1 add a time limit");
    const result = await catchUp(db, { root: repo, ladders, now: NOW });
    expect(result).toMatchObject({ started: true, commits_read: 1, more_left: false });
    expect(evidence()).toContainEqual({
      ladder_id: "builtin/backend",
      item_id: "BE.ERR.M2",
      signal_id: "err.timeout-set",
      polarity: "positive",
      author: "dev",
      file_path: "src/pay.ts",
      symbol: "charge",
      ticket: "PAY-1",
      fixed_ticket: null,
    });
  });

  it("marks a line Claude wrote as AI-written", async () => {
    startCapture();
    saveAiLines(db, top, "src/pay.ts", "s1", [TIMEOUT_LINE]);
    commit({ "src/pay.ts": PAY(TIMEOUT_LINE) }, "PAY-1 add a time limit");
    await catchUp(db, { root: repo, ladders, now: NOW });
    expect(evidence().find((e) => e.signal_id === "err.timeout-set")?.author).toBe("ai");
  });

  it("adds nothing when run twice", async () => {
    startCapture();
    commit({ "src/pay.ts": PAY(TIMEOUT_LINE) }, "PAY-1 add a time limit");
    await catchUp(db, { root: repo, ladders, now: NOW });
    const before = evidence().length;
    const again = await catchUp(db, { root: repo, ladders, now: NOW });
    expect(again.commits_read).toBe(0);
    expect(evidence().length).toBe(before);
  });

  it("does not read a cherry-picked copy of a commit twice", async () => {
    startCapture();
    commit({ "base.txt": "b\n" }, "base");
    git(["checkout", "-q", "-b", "feature"]);
    const original = commit({ "src/pay.ts": PAY(TIMEOUT_LINE) }, "PAY-1 add a time limit", "2026-11-11T10:00:00Z");
    git(["checkout", "-q", "main"]);
    commit({ "other.txt": "o\n" }, "other", "2026-11-12T10:00:00Z");
    git(["cherry-pick", original], { GIT_COMMITTER_DATE: "2026-11-13T10:00:00Z" });
    await catchUp(db, { root: repo, ladders, now: NOW });
    expect(evidence().filter((e) => e.signal_id === "err.timeout-set")).toHaveLength(1);
  });

  it("marks a fault fixed when a later commit removes it", async () => {
    startCapture();
    commit({ "src/pay.ts": PAY("  try { await save(); } catch (e) {}") }, "PAY-1 save", "2026-11-10T10:00:00Z");
    commit({ "src/pay.ts": PAY("  await save();") }, "PAY-1 stop hiding the error", "2026-11-11T10:00:00Z");
    const result = await catchUp(db, { root: repo, ladders, now: NOW });
    expect(result.faults_fixed).toBeGreaterThan(0);
    const fault = evidence().find((e) => e.signal_id === "err.empty-catch" && e.item_id === "BE.ERR.J1");
    expect(fault).toMatchObject({ polarity: "negative", symbol: "charge", fixed_ticket: "PAY-1" });
  });

  it("removes AI line hashes older than 120 days", async () => {
    startCapture();
    db.prepare("INSERT INTO ai_line_hashes (repo_root, file_path, hash, session_id, created_at) VALUES (?, 'old.ts', 'old', 's0', '2026-01-01 00:00:00')").run(top);
    await catchUp(db, { root: repo, ladders, now: NOW });
    expect(db.prepare("SELECT 1 FROM ai_line_hashes WHERE hash = 'old'").get()).toBeUndefined();
  });

  it("waits for Claude's first edit in the repo", async () => {
    commit({ "src/pay.ts": PAY(TIMEOUT_LINE) }, "PAY-1 add a time limit");
    const result = await catchUp(db, { root: repo, ladders, now: NOW });
    expect(result.started).toBe(false);
    expect(result.note).toMatch(/first edit/);
  });

  it("explains plainly when the folder is not a git repo (Review Focus 1)", async () => {
    const plain = join(dir, "plain");
    mkdirSync(plain);
    const result = await catchUp(db, { root: plain, ladders, now: NOW });
    expect(result.started).toBe(false);
    expect(result.note).toMatch(/not a git repo/);
  });

  it("explains plainly when no user.email is set (Review Focus 1)", async () => {
    startCapture();
    git(["config", "--unset", "user.email"]);
    // Hide the machine's global git config too, so no email is found anywhere.
    const isolated: Run = (command, args, cwd) =>
      new Promise((resolve) =>
        execFile(command, args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: join(dir, "none"), GIT_CONFIG_NOSYSTEM: "1" } }, (error, stdout, stderr) =>
          resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) }),
        ),
      );
    const result = await catchUp(db, { root: repo, ladders, now: NOW, exec: isolated });
    expect(result.started).toBe(false);
    expect(result.note).toMatch(/user\.email/);
  });

  it("skips lockfiles, build output and generated files quickly (Review Focus 2)", async () => {
    startCapture();
    const generated = Array.from({ length: 20_000 }, (_, i) => `function f${i}() { try { g(); } catch (e) {} }`).join("\n");
    commit(
      {
        "package-lock.json": JSON.stringify({ lockfileVersion: 3 }),
        "dist/app.min.js": "try{a()}catch(e){}",
        "src/schema.generated.ts": generated,
      },
      "PAY-1 generated",
    );
    const started = Date.now();
    await catchUp(db, { root: repo, ladders, now: NOW });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(evidence()).toEqual([]);
  });
});

describe("ticketForCommit", () => {
  const c = (subject: string, authorDate = "2026-11-12T10:00:00+02:00") => ({ sha: "a", authorEmail: "d", authorDate, subject });
  it("takes a ticket key from the subject", () => {
    expect(ticketForCommit(c("PAY-12 add retry"), { onDefault: true, branch: "main" })).toBe("PAY-12");
  });
  it("takes the branch name for a commit off the default branch", () => {
    expect(ticketForCommit(c("add retry"), { onDefault: false, branch: "feature/retry" })).toBe("feature/retry");
  });
  it("takes the ISO week for a commit on the default branch with no key", () => {
    expect(ticketForCommit(c("add retry"), { onDefault: true, branch: "main" })).toBe("week:2026-W46");
    expect(ticketForCommit(c("x", "2027-01-01T10:00:00Z"), { onDefault: true, branch: null })).toBe("week:2026-W53");
  });
});

describe("isGeneratedPath", () => {
  it("knows generated and vendored files", () => {
    for (const p of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "Cargo.lock", "dist/a.js", "web/build/x.js", "vendor/a.go", "node_modules/a/b.js", "a.min.js", "schema.generated.ts", "src/__generated__/x.ts"]) {
      expect(isGeneratedPath(p), p).toBe(true);
    }
    expect(isGeneratedPath("src/pay.ts")).toBe(false);
  });
});
