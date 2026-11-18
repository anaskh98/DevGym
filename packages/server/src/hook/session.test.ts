import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { repoIdentitySync } from "../git/identity.js";

const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "server");
const start = join(serverDir, "start.mjs");
const built = existsSync(join(serverDir, "session.mjs")) && existsSync(join(serverDir, "background.mjs"));

let dir: string;
let dbPath: string;
let repo: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ftc-session-"));
  dbPath = join(dir, "test.sqlite");
  repo = join(dir, "repo");
  mkdirSync(repo);
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const env = () => ({ ...process.env, FTC_DB_PATH: dbPath });
function session(event: string) {
  const r = spawnSync(process.execPath, [start, "session"], { input: JSON.stringify({ session_id: "s1", cwd: repo, hook_event_name: event }), encoding: "utf8", env: env() });
  return { status: r.status, stdout: r.stdout.trim() };
}
function withDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb(dbPath);
  try {
    migrate(db);
    return fn(db);
  } finally {
    db.close();
  }
}
function pendingQuestion() {
  withDb((db) => {
    db.prepare("INSERT INTO coach_settings (key, value) VALUES ('tracks', '[\"backend\"]')").run();
    db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket) VALUES ('q1', 'why', 'builtin/backend', 'BE.ERR.M2', 'PAY-1')").run();
  });
}

describe.skipIf(!built)("session hook", () => {
  it("stays silent and exits 0 when there is no database", () => {
    expect(session("SessionStart")).toEqual({ status: 0, stdout: "" });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("gives one short nudge when questions wait, then not again for a day", () => {
    pendingQuestion();
    const first = session("SessionStart");
    expect(first.status).toBe(0);
    const note = JSON.parse(first.stdout).hookSpecificOutput;
    expect(note.hookEventName).toBe("SessionStart");
    expect(note.additionalContext).toMatch(/1 coach question/);
    expect(note.additionalContext.split("\n")).toHaveLength(1);
    expect(session("SessionStart").stdout).toBe("");
  });

  it("does not nudge at Stop, and never when nothing waits", () => {
    pendingQuestion();
    expect(session("Stop").stdout).toBe("");
    withDb((db) => db.prepare("DELETE FROM pending_questions").run());
    expect(session("SessionStart").stdout).toBe("");
  });

  it("never fails the session on bad input", () => {
    const r = spawnSync(process.execPath, [start, "session"], { input: "not json", encoding: "utf8", env: env() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

describe.skipIf(!built)("background worker", () => {
  it("reads the developer's commits without anyone running a command", () => {
    const git = (args: string[], e: Record<string, string> = {}) => execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...e } }).trim();
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "dev@example.com"]);
    git(["config", "user.name", "Dev"]);
    git(["config", "commit.gpgsign", "false"]);
    const key = repoIdentitySync(repo)!.key;
    withDb((db) => {
      db.prepare("INSERT INTO coach_settings (key, value) VALUES ('tracks', '[\"backend\"]')").run();
      db.prepare("INSERT INTO ai_line_hashes (repo_root, file_path, hash, session_id, created_at) VALUES (?, 'x', 'seed', 's0', '2026-01-01 00:00:00')").run(key);
    });
    writeFileSync(join(repo, "pay.ts"), "export async function charge(url: string) {\n  return fetch(url, { signal: AbortSignal.timeout(4000) });\n}\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "PAY-1 charge"]);
    const r = spawnSync(process.execPath, [start, "background", repo], { encoding: "utf8", env: env(), timeout: 60_000 });
    expect(r.status).toBe(0);
    const n = withDb((db) => (db.prepare("SELECT count(*) AS n FROM skill_evidence WHERE signal_id = 'err.timeout-set'").get() as { n: number }).n);
    expect(n).toBe(1);
  }, 90_000);
});
