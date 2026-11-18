import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { setTracks } from "./settings.js";
import { coachStatus, renderProgress, stateHistory } from "./status.js";

let db: Db;
let dir: string;
let repo: string;
let top: string;
const NOW = new Date("2026-11-18T12:00:00Z");

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, ...env } }).trim();
}
function commit(files: Record<string, string>, message: string, date: string) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(repo, path, ".."), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
}
function addEvidence(itemId: string, ticket: string, symbol: string) {
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', ?, 'rule', 'positive', 'dev', ?, 'err.timeout-set', 'src/pay.ts', ?, '2026-11-12T10:00:00Z')",
  ).run(randomUUID(), itemId, ticket, symbol);
}
function addAnswer(itemId: string, ticket: string, tradeoff: boolean) {
  db.prepare(
    "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, question, answer, answered_at, closed_reason, rating, names_tradeoff) VALUES (?, 'why', 'builtin/backend', ?, ?, 'q', 'a', '2026-11-13T10:00:00Z', 'answered', 'clear', ?)",
  ).run(randomUUID(), itemId, ticket, tradeoff ? 1 : 0);
}

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  dir = mkdtempSync(join(tmpdir(), "ftc-status-"));
  repo = join(dir, "repo");
  mkdirSync(repo);
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "dev@example.com"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
  top = git(["rev-parse", "--show-toplevel"]);
  db.prepare("INSERT INTO ai_line_hashes (repo_root, file_path, hash, session_id, created_at) VALUES (?, 'x', 'seed', 's0', '2026-11-01 00:00:00')").run(top);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { express: "^4" } }));
  commit(
    { "src/pay.ts": "export async function charge(url: string) {\n  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });\n}\n" },
    "PAY-1 add a time limit",
    "2026-11-10T10:00:00Z",
  );
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("coachStatus", () => {
  it("asks for tracks first", async () => {
    const s = await coachStatus(db, { root: repo, now: NOW, home: dir });
    expect(s.tracks).toEqual([]);
    expect(s.areas).toEqual([]);
    expect(s.text).toMatch(/backend, frontend, or both/);
  });

  it("reads commits and shows the item, the state and the stack", async () => {
    setTracks(db, ["backend"]);
    const s = await coachStatus(db, { root: repo, now: NOW, home: dir });
    expect(s.catch_up.commits_read).toBe(1);
    const err = s.areas.find((a) => a.area_id === "ERR")!;
    expect(err.items.find((i) => i.item_id === "BE.ERR.M2")?.state).toBe("learning");
    expect(s.text).toContain("BE.ERR.M2");
    expect(s.text).toContain("LEARNING");
    expect(s.text).toContain("Your stack: express");
    expect(s.text).toContain("Not written yet:");
  });

  it("writes a history row only when a state changes", async () => {
    setTracks(db, ["backend"]);
    await coachStatus(db, { root: repo, now: NOW, home: dir });
    const first = stateHistory(db).length;
    await coachStatus(db, { root: repo, now: NOW, home: dir });
    expect(stateHistory(db).length).toBe(first);

    addEvidence("BE.ERR.M2", "PAY-1", "a");
    addEvidence("BE.ERR.M2", "PAY-2", "b");
    addAnswer("BE.ERR.M2", "PAY-1", true);
    addAnswer("BE.ERR.M2", "PAY-2", false);
    await coachStatus(db, { root: repo, now: NOW, home: dir });
    const changes = stateHistory(db).filter((h) => h.item_id === "BE.ERR.M2");
    expect(changes.map((h) => `${h.from_state}->${h.to_state}`)).toEqual(["not_seen->learning", "learning->shown"]);
  });

  it("ignores evidence for an item that is not in the ladder (Review Focus 5)", async () => {
    setTracks(db, ["backend"]);
    addEvidence("BE.ERR.M9", "PAY-1", "z");
    const s = await coachStatus(db, { root: repo, now: NOW, home: dir });
    expect(s.areas.flatMap((a) => a.items.map((i) => i.item_id))).not.toContain("BE.ERR.M9");
  });
});

describe("renderProgress", () => {
  it("shows a proven item above the level being worked on", async () => {
    setTracks(db, ["backend"]);
    const s = await coachStatus(db, { root: repo, now: NOW, home: dir });
    const area = s.areas.find((a) => a.area_id === "ERR")!;
    const m3 = area.items.find((i) => i.item_id === "BE.ERR.M3")!;
    m3.state = "proven";
    m3.detail = "drill passed 15 Nov";
    expect(renderProgress({ ...s, areas: [area] })).toContain("BE.ERR.M3");
  });
});
