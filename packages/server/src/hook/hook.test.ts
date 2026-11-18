import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { toRepoPath } from "../paths.js";

// Runs the bundled hook that ships in the plugin, the way Claude Code does: JSON on stdin.
// Run "pnpm build" first: these tests are skipped when the bundle is missing.
const serverDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "server");
const start = join(serverDir, "start.mjs");
const built = existsSync(join(serverDir, "hook.mjs"));

let dir: string;
let dbPath: string;
let project: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "devgym-hook-"));
  dbPath = join(dir, "test.sqlite");
  project = join(dir, "project");
  mkdirSync(project);
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

function runHook(stdin: string) {
  const result = spawnSync(process.execPath, [start, "hook"], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, DEVGYM_DB_PATH: dbPath },
  });
  return { status: result.status, stdout: result.stdout.trim() };
}

const editEvent = (sessionId: string, file: string) =>
  JSON.stringify({ session_id: sessionId, cwd: project, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file } });

function trackSession(sessionId: string) {
  const db = openDb(dbPath);
  migrate(db);
  db.prepare("INSERT INTO tickets (id, title, body, source) VALUES ('T-1', 't', 'b', 'test')").run();
  db.prepare("INSERT INTO trail_sessions (session_id, ticket_id) VALUES (?, 'T-1')").run(sessionId);
  db.close();
}

function edits() {
  const db = openDb(dbPath);
  try {
    return db.prepare("SELECT session_id, file_path, edit_count FROM file_edits ORDER BY file_path").all().map((r) => ({ ...r }));
  } finally {
    db.close();
  }
}

describe.skipIf(!built)("edit hook", () => {
  it("records an edit for a tracked session and reminds Claude once per file", () => {
    trackSession("s1");
    const first = runHook(editEvent("s1", join(project, "src", "export.ts")));
    expect(first.status).toBe(0);
    const note = JSON.parse(first.stdout).hookSpecificOutput;
    expect(note.hookEventName).toBe("PostToolUse");
    expect(note.additionalContext).toContain("src/export.ts");

    const second = runHook(editEvent("s1", join(project, "src", "export.ts")));
    expect(second).toEqual({ status: 0, stdout: "" });
    expect(edits()).toEqual([{ session_id: "s1", file_path: "src/export.ts", edit_count: 2 }]);
  });

  it("records nothing for a session that is not tracked", () => {
    trackSession("s1");
    expect(runHook(editEvent("someone-else", join(project, "a.ts")))).toEqual({ status: 0, stdout: "" });
    expect(edits()).toEqual([]);
  });

  it("does not create a database when none exists", () => {
    expect(runHook(editEvent("s1", join(project, "a.ts")))).toEqual({ status: 0, stdout: "" });
    expect(existsSync(dbPath)).toBe(false);
  });

  it("ignores files outside the project", () => {
    trackSession("s1");
    expect(runHook(editEvent("s1", join(dir, "outside.ts")))).toEqual({ status: 0, stdout: "" });
    expect(edits()).toEqual([]);
  });

  it("does not record a path that names a denylisted client", () => {
    trackSession("s1");
    writeFileSync(join(dir, "denylist.txt"), "Globex\n"); // the list lives next to the database
    expect(runHook(editEvent("s1", join(project, "src", "clients", "globex", "export.ts")))).toEqual({ status: 0, stdout: "" });
    expect(runHook(editEvent("s1", join(project, "src", "export.ts"))).stdout).toContain("src/export.ts");
    expect(edits()).toEqual([{ session_id: "s1", file_path: "src/export.ts", edit_count: 1 }]);
  });

  it("never fails the session on bad input", () => {
    trackSession("s1");
    expect(runHook("not json")).toEqual({ status: 0, stdout: "" });
    expect(runHook("{}")).toEqual({ status: 0, stdout: "" });
    expect(runHook(JSON.stringify({ session_id: "s1", cwd: project, tool_input: {} }))).toEqual({ status: 0, stdout: "" });
  });
});

describe.skipIf(!built)("edit hook: who wrote the line", () => {
  function gitInit() {
    execFileSync("git", ["init", "-q"], { cwd: project });
  }
  function hashes() {
    const db = openDb(dbPath);
    try {
      return db.prepare("SELECT file_path, session_id FROM ai_line_hashes ORDER BY hash").all().map((r) => ({ ...r }));
    } finally {
      db.close();
    }
  }
  const edit = (sessionId: string, file: string, newString: string) =>
    JSON.stringify({ session_id: sessionId, cwd: project, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: file, new_string: newString } });

  it("saves a hash per line Claude wrote, for any session in a git repo, and creates the database", () => {
    gitInit();
    const result = runHook(edit("untracked", join(project, "src", "pay.ts"), "const timeout = 5000;\n}\nawait charge(card);"));
    expect(result).toEqual({ status: 0, stdout: "" });
    expect(hashes()).toEqual([
      { file_path: "src/pay.ts", session_id: "untracked" },
      { file_path: "src/pay.ts", session_id: "untracked" },
    ]);
  });

  it("saves hashes when Claude was started in a folder above the repo", () => {
    gitInit();
    const event = JSON.stringify({ session_id: "above", cwd: dir, hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(project, "src", "pay.ts"), new_string: "const timeout = 5000;" } });
    expect(runHook(event)).toEqual({ status: 0, stdout: "" });
    expect(hashes()).toEqual([{ file_path: "src/pay.ts", session_id: "above" }]);
  });

  it("stays silent and exits 0 when the database cannot be opened", () => {
    gitInit();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file, so a folder cannot be made here");
    const result = spawnSync(process.execPath, [start, "hook"], {
      input: edit("s1", join(project, "a.ts"), "const timeout = 5000;"),
      encoding: "utf8",
      env: { ...process.env, DEVGYM_DB_PATH: join(blocker, "sub", "db.sqlite") },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("");
  });
});

describe("toRepoPath", () => {
  const root = join(tmpdir(), "repo");
  it("makes paths relative with forward slashes", () => {
    expect(toRepoPath(join(root, "src", "a.ts"), root)).toBe("src/a.ts");
    expect(toRepoPath("src/a.ts", root)).toBe("src/a.ts");
    expect(toRepoPath("./src/a.ts", root)).toBe("src/a.ts");
  });
  it("returns null outside the root", () => {
    expect(toRepoPath(join(tmpdir(), "other", "a.ts"), root)).toBeNull();
    expect(toRepoPath("../a.ts", root)).toBeNull();
    expect(toRepoPath(root, root)).toBeNull();
  });
});
