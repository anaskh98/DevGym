import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";

// Runs the bundled prompt hook the way Claude Code does: JSON on stdin. Skipped when the bundle is missing.
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "server");
const start = join(serverDir, "start.mjs");
const built = existsSync(join(serverDir, "prompt.mjs"));

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ftc-prompt-"));
  dbPath = join(dir, "test.sqlite");
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function runPrompt(sessionId: string, prompt: string) {
  const result = spawnSync(process.execPath, [start, "prompt"], {
    input: JSON.stringify({ session_id: sessionId, cwd: dir, hook_event_name: "UserPromptSubmit", prompt }),
    encoding: "utf8",
    env: { ...process.env, FTC_DB_PATH: dbPath },
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

function openQuestionFor(sessionId: string): string {
  const db = openDb(dbPath);
  try {
    migrate(db);
    const id = randomUUID();
    db.prepare(
      "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, question, opened_at, open_session) VALUES (?, 'why', 'builtin/backend', 'BE.ERR.M2', 'PAY-1', 'Why 5 seconds?', ?, ?)",
    ).run(id, new Date().toISOString(), sessionId);
    return id;
  } finally {
    db.close();
  }
}

function answerOf(id: string) {
  const db = openDb(dbPath);
  try {
    return (db.prepare("SELECT answer FROM pending_questions WHERE id = ?").get(id) as { answer: string | null }).answer;
  } finally {
    db.close();
  }
}

describe.skipIf(!built)("prompt hook", () => {
  it("saves the developer's message as the answer and tells Claude", () => {
    const id = openQuestionFor("s1");
    const out = runPrompt("s1", "Because the provider can hang and our caller gives up first");
    expect(out.status).toBe(0);
    const note = JSON.parse(out.stdout).hookSpecificOutput;
    expect(note.hookEventName).toBe("UserPromptSubmit");
    expect(note.additionalContext).toContain(id);
    expect(answerOf(id)).toBe("Because the provider can hang and our caller gives up first");
  });

  it("stays silent when no question is open", () => {
    openQuestionFor("s1");
    expect(runPrompt("other", "hello")).toEqual({ status: 0, stdout: "" });
  });

  it("does not make a database", () => {
    expect(runPrompt("s1", "hello")).toEqual({ status: 0, stdout: "" });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("never fails the session on bad input", () => {
    const result = spawnSync(process.execPath, [start, "prompt"], { input: "not json", encoding: "utf8", env: { ...process.env, FTC_DB_PATH: dbPath } });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});
