// PostToolUse hook: after Claude edits a file, record its path for the tracked session, and save a hash of each
// line Claude wrote (for any session in a git repo), so Coach can tell AI-written lines from the developer's.
// A hook must never break the developer's session, so every failure ends quietly with exit code 0.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { linesFromToolInput, saveAiLines } from "../coach/attribution.js";
import { defaultDbPath, openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { toRepoPath } from "../paths.js";
import { containsBlockedName, loadDenylist } from "../privacy/denylist.js";
import { recordFileEdit } from "../store.js";

interface HookInput {
  session_id?: unknown;
  cwd?: unknown;
  tool_name?: unknown;
  tool_input?: { file_path?: unknown; notebook_path?: unknown };
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** The git repo the file is in, as git prints it, or null. Never throws. */
function repoTopLevel(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 3000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return out.trim() || null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as HookInput;
  const sessionId = input.session_id;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  if (typeof sessionId !== "string" || typeof file !== "string") return;

  // Who wrote the line needs a record for every session in a git repo, so the database is made if missing.
  // Outside a git repo nothing is read from commits, so no database is made just for this edit.
  const repoRoot = repoTopLevel(cwd);
  if (repoRoot === null && !existsSync(defaultDbPath())) return;

  const repoPath = toRepoPath(file, cwd);
  if (repoPath === null) return; // Outside the project: not ours to record.
  // Privacy guard for this write: a path that names a client is not recorded at all.
  const denylist = loadDenylist();
  if (containsBlockedName(repoPath, denylist)) return;

  const db = openDb();
  try {
    migrate(db);
    if (repoRoot !== null) {
      const pathInRepo = toRepoPath(file, repoRoot);
      const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
      if (pathInRepo !== null) saveAiLines(db, repoRoot, pathInRepo, sessionId, linesFromToolInput(toolName, input.tool_input));
    }
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
