// PostToolUse hook: after Claude edits a file, record its path for the tracked session, and save a hash of each
// line Claude wrote (for any session in a git repo), so Grow can tell AI-written lines from the developer's.
// A hook must never break the developer's session, so every failure ends quietly with exit code 0.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { repoIdentitySync } from "../git/identity.js";
import { linesFromToolInput, saveAiLines } from "../grow/attribution.js";
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

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as HookInput;
  const sessionId = input.session_id;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  if (typeof sessionId !== "string" || typeof file !== "string") return;

  // Who wrote the line needs a record for every session in a git repo, so the database is made if missing.
  // Outside a git repo nothing is read from commits, so no database is made just for this edit.
  // The repo is found from the edited file's own folder, so it works when Claude runs above the repo or in a worktree.
  const absolute = isAbsolute(file) ? file : resolve(cwd, file);
  let folder = dirname(absolute);
  while (!existsSync(folder) && dirname(folder) !== folder) folder = dirname(folder); // the nearest folder that exists
  const repo = repoIdentitySync(folder);
  if (repo === null && !existsSync(defaultDbPath())) return;

  const repoPath = toRepoPath(file, cwd);
  if (repoPath === null) return; // Outside the project: not ours to record.
  // Privacy guard for this write: a path that names a client is not recorded at all.
  const denylist = loadDenylist();
  if (containsBlockedName(repoPath, denylist)) return;

  const db = openDb();
  try {
    migrate(db);
    if (repo !== null) {
      const pathInRepo = toRepoPath(absolute, repo.top);
      const toolName = typeof input.tool_name === "string" ? input.tool_name : "";
      if (pathInRepo !== null && !containsBlockedName(pathInRepo, denylist)) {
        saveAiLines(db, repo.key, pathInRepo, sessionId, linesFromToolInput(toolName, input.tool_input));
      }
    }
    const { tracked, first } = recordFileEdit(db, sessionId, repoPath);
    if (tracked && first) {
      // Shown to Claude, once per file, so long sessions do not forget the rule.
      const note =
        `Track: first edit to ${repoPath} in this session. ` +
        `If this edit involved a real choice between options, call log_decision with pointer.file_path "${repoPath}". ` +
        `If an earlier decision already covers it, no action is needed now; get_track lists files with no decision.`;
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
  console.error(`devgym hook: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
