// SessionStart and Stop hook. It does two small things and never blocks:
//  1. At most every 10 minutes per project, it starts a detached background worker that reads the developer's new
//     commits (no command needed, nothing printed, the session never waits for it).
//  2. At SessionStart only, when Coach questions are waiting, it adds ONE short line for Claude, at most once a day.
// A hook must never break the session, so every failure ends quietly with exit code 0.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { defaultDbPath, openDb } from "../db/connection.js";

interface Input {
  cwd?: unknown;
  hook_event_name?: unknown;
}

const THROTTLE_MS = 10 * 60_000;
const NUDGE_EVERY_MS = 24 * 3_600_000;

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function main(stdin: string): void {
  const input = JSON.parse(stdin) as Input;
  if (typeof input.cwd !== "string") return;
  // No database means no Coach was ever set up. Do not create one just to find that out.
  if (!existsSync(defaultDbPath())) return;
  const db = openDb();
  let spawnFor: string | null = null;
  let note: string | null = null;
  try {
    // The tables may not exist yet on an old database; the migrations run in the other hooks and the server.
    const setting = (key: string) => (db.prepare("SELECT value FROM coach_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
    const put = (key: string, value: unknown) =>
      db.prepare("INSERT INTO coach_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
    const tracks = setting("tracks");
    if (tracks === undefined || JSON.parse(tracks).length === 0) return; // Coach is not set up: stay out of the way.

    const now = Date.now();
    const lastRun = Number(JSON.parse(setting(`bg_last:${input.cwd}`) ?? "0"));
    if (now - lastRun >= THROTTLE_MS) {
      put(`bg_last:${input.cwd}`, now);
      spawnFor = input.cwd;
    }
    if (input.hook_event_name === "SessionStart") {
      const waiting = Number(
        (db.prepare("SELECT count(*) AS n FROM pending_questions WHERE answered_at IS NULL AND kind != 'drill' AND (closed_reason IS NULL OR closed_reason IN ('later', 'timeout'))").get() as { n: number }).n,
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
  // FTC_NO_BACKGROUND=1 turns the background worker off (tests, or a developer who prefers to run Coach by hand).
  if (spawnFor !== null && process.env.FTC_NO_BACKGROUND !== "1") {
    // Detached: the worker outlives this hook, so the session never waits for it.
    const child = spawn(process.execPath, [process.argv[1]!, "background", spawnFor], { detached: true, stdio: "ignore", windowsHide: true, env: process.env });
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
