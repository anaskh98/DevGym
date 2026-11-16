// PostToolUse hook: after Claude edits a file, record its path for the tracked session.
// A hook must never break the developer's session, so every failure ends quietly with exit code 0.
import { existsSync } from "node:fs";
import { defaultDbPath, openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { toRepoPath } from "../paths.js";
import { containsBlockedName, loadDenylist } from "../privacy/denylist.js";
import { recordFileEdit } from "../store.js";

interface HookInput {
  session_id?: unknown;
  cwd?: unknown;
  tool_input?: { file_path?: unknown; notebook_path?: unknown };
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as HookInput;
  const sessionId = input.session_id;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  if (typeof sessionId !== "string" || typeof file !== "string") return;

  // No database yet means no session was ever tracked. Do not create one just to find that out.
  if (!existsSync(defaultDbPath())) return;

  const repoPath = toRepoPath(file, cwd);
  if (repoPath === null) return; // Outside the project: not ours to record.
  // Privacy guard for this write: a path that names a client is not recorded at all.
  if (containsBlockedName(repoPath, loadDenylist())) return;

  const db = openDb();
  try {
    migrate(db);
    const { tracked, first } = recordFileEdit(db, sessionId, repoPath);
    if (tracked && first) {
      // Shown to Claude, once per file, so long sessions do not forget the rule.
      const note =
        `Paper Trail: first edit to ${repoPath} in this session. ` +
        `If this edit involved a real choice between options, call log_decision with pointer.file_path "${repoPath}". ` +
        `If an earlier decision already covers it, no action is needed now; get_trail lists files with no decision.`;
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } }),
      );
    }
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`fork-trail-coach hook: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
