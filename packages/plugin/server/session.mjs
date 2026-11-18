import { createRequire as __ftcCreateRequire } from 'node:module';
const require = __ftcCreateRequire(import.meta.url);

// src/hook/session-hook.ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

// src/db/connection.ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
function defaultDbPath() {
  return process.env.FTC_DB_PATH ?? join(homedir(), ".fork-trail-coach", "profile.sqlite");
}
function openDb(path = defaultDbPath()) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

// src/hook/session-hook.ts
var THROTTLE_MS = 10 * 6e4;
var NUDGE_EVERY_MS = 24 * 36e5;
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}
function main(stdin) {
  const input = JSON.parse(stdin);
  if (typeof input.cwd !== "string") return;
  if (!existsSync(defaultDbPath())) return;
  const db = openDb();
  let spawnFor = null;
  let note = null;
  try {
    const setting = (key) => db.prepare("SELECT value FROM coach_settings WHERE key = ?").get(key)?.value;
    const put = (key, value) => db.prepare("INSERT INTO coach_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
    const tracks = setting("tracks");
    if (tracks === void 0 || JSON.parse(tracks).length === 0) return;
    const now = Date.now();
    const lastRun = Number(JSON.parse(setting(`bg_last:${input.cwd}`) ?? "0"));
    if (now - lastRun >= THROTTLE_MS) {
      put(`bg_last:${input.cwd}`, now);
      spawnFor = input.cwd;
    }
    if (input.hook_event_name === "SessionStart") {
      const waiting = Number(
        db.prepare("SELECT count(*) AS n FROM pending_questions WHERE answered_at IS NULL AND kind != 'drill' AND (closed_reason IS NULL OR closed_reason IN ('later', 'timeout'))").get().n
      );
      const lastNudge = Number(JSON.parse(setting("nudge_last") ?? "0"));
      if (waiting > 0 && now - lastNudge >= NUDGE_EVERY_MS) {
        put("nudge_last", now);
        note = `Coach: ${waiting} coach question${waiting === 1 ? " is" : "s are"} waiting about the developer's recent work. If it fits a natural pause, mention once that they can run /fork-trail-coach:coach. Do not interrupt.`;
      }
    }
  } finally {
    db.close();
  }
  if (spawnFor !== null) {
    const child = spawn(process.execPath, [process.argv[1], "background", spawnFor], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
    child.unref();
  }
  if (note !== null) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: note } }));
  }
}
try {
  main(await readStdin());
} catch (err) {
  console.error(`fork-trail-coach session hook: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
