import { createRequire as __ftcCreateRequire } from 'node:module';
const require = __ftcCreateRequire(import.meta.url);

// src/hook/post-tool-use.ts
import { existsSync } from "node:fs";
import { dirname as dirname3, isAbsolute as isAbsolute2, resolve as resolve3 } from "node:path";

// src/git/identity.ts
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
function normalizeRepoPath(path) {
  let p = resolve(path);
  try {
    p = realpathSync.native(p);
  } catch {
  }
  p = p.replaceAll("\\", "/");
  return process.platform === "win32" ? p.toLowerCase() : p;
}
var ARGS = ["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"];
function parse(stdout) {
  const [top, common] = stdout.trim().split(/\r?\n/);
  return top && common ? { top, key: normalizeRepoPath(common) } : null;
}
function repoIdentitySync(cwd) {
  try {
    return parse(execFileSync("git", ARGS, { cwd, encoding: "utf8", timeout: 3e3, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

// src/coach/attribution.ts
import { createHash } from "node:crypto";
function normalizeLine(line) {
  let s = line.replace(/\s+/g, "").replace(/['`]/g, '"');
  if (s.endsWith(",") || s.endsWith(";")) s = s.slice(0, -1);
  return s.length >= 4 ? s : null;
}
function lineHash(normalized) {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}
function linesOf(value) {
  return typeof value === "string" ? value.split(/\r?\n/) : [];
}
function linesFromToolInput(toolName, toolInput) {
  if (typeof toolInput !== "object" || toolInput === null) return [];
  const input = toolInput;
  switch (toolName) {
    case "Edit":
      return linesOf(input.new_string);
    case "Write":
      return linesOf(input.content);
    case "NotebookEdit":
      return linesOf(input.new_source);
    case "MultiEdit":
      return Array.isArray(input.edits) ? input.edits.flatMap((e) => typeof e === "object" && e !== null ? linesOf(e.new_string) : []) : [];
    default:
      return [];
  }
}
function saveAiLines(db, repoRoot, filePath, sessionId, lines) {
  const insert = db.prepare("INSERT OR IGNORE INTO ai_line_hashes (repo_root, file_path, hash, session_id) VALUES (?, ?, ?, ?)");
  let stored = 0;
  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (normalized === null) continue;
    stored += Number(insert.run(repoRoot, filePath, lineHash(normalized), sessionId).changes);
  }
  return stored;
}

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
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// src/db/migrations.ts
var migrations = [
  {
    id: 1,
    name: "initial_data_model",
    sql: `
      CREATE TABLE tickets (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        source     TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE assumptions (
        id         TEXT PRIMARY KEY,
        ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        text       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('answered_by_po', 'assumed_by_dev')),
        answer     TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_assumptions_ticket ON assumptions(ticket_id);

      -- A pointer references code. It never stores the code itself.
      CREATE TABLE pointers (
        id         TEXT PRIMARY KEY,
        repo       TEXT NOT NULL,
        pr_number  INTEGER,
        file_path  TEXT NOT NULL,
        symbol     TEXT,
        commit_sha TEXT,
        line_hint  INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE decisions (
        id           TEXT PRIMARY KEY,
        ticket_id    TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        session_id   TEXT NOT NULL,
        summary      TEXT NOT NULL,
        alternatives TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alternatives)),
        origin       TEXT NOT NULL CHECK (origin IN ('ai', 'dev', 'dev_changed_ai')),
        pointer_id   TEXT REFERENCES pointers(id) ON DELETE SET NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_decisions_ticket ON decisions(ticket_id);
      CREATE INDEX idx_decisions_session ON decisions(session_id);

      CREATE TABLE explain_backs (
        id          TEXT PRIMARY KEY,
        decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        question    TEXT NOT NULL,
        answer      TEXT NOT NULL,
        rating      TEXT NOT NULL CHECK (rating IN ('clear', 'partial', 'not_yet')),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_explain_backs_decision ON explain_backs(decision_id);

      CREATE TABLE observations (
        id           TEXT PRIMARY KEY,
        developer_id TEXT NOT NULL,
        skill_tag    TEXT NOT NULL,
        summary      TEXT NOT NULL,
        evidence_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(evidence_ids)),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_observations_developer ON observations(developer_id);

      -- focus_areas is a JSON list of { claim, evidence_ids, tentative, exercise }.
      CREATE TABLE growth_plans (
        id           TEXT PRIMARY KEY,
        developer_id TEXT NOT NULL,
        focus_areas  TEXT NOT NULL CHECK (json_valid(focus_areas)),
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_growth_plans_developer ON growth_plans(developer_id);

      -- target_id can point at any record (a claim, a decision...), so no foreign key.
      CREATE TABLE annotations (
        id         TEXT PRIMARY KEY,
        target_id  TEXT NOT NULL,
        note       TEXT NOT NULL,
        disagrees  INTEGER NOT NULL DEFAULT 0 CHECK (disagrees IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_annotations_target ON annotations(target_id);
    `
  },
  {
    id: 2,
    name: "paper_trail_capture",
    sql: `
      -- A coding session the developer chose to track. File edits are recorded only for these.
      CREATE TABLE trail_sessions (
        session_id TEXT PRIMARY KEY,
        ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        started_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- Which files were edited in a tracked session. Paths only, never content.
      CREATE TABLE file_edits (
        session_id      TEXT NOT NULL REFERENCES trail_sessions(session_id) ON DELETE CASCADE,
        file_path       TEXT NOT NULL,
        edit_count      INTEGER NOT NULL DEFAULT 1,
        first_edited_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_edited_at  TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (session_id, file_path)
      );

      -- Other files a decision covers, besides the one its pointer names. A JSON list of paths.
      ALTER TABLE decisions ADD COLUMN related_files TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(related_files));
    `
  },
  {
    id: 3,
    name: "pointer_resolve_check",
    sql: `
      -- Result of the last resolve check: 1 = the pointer finds its code at commit_sha,
      -- 0 = broken (resolve_note says why), NULL = never checked.
      ALTER TABLE pointers ADD COLUMN resolved INTEGER CHECK (resolved IN (0, 1));
      ALTER TABLE pointers ADD COLUMN resolved_at TEXT;
      ALTER TABLE pointers ADD COLUMN resolve_note TEXT;
    `
  },
  {
    // Ids 4 to 6 are left free on purpose: other branches of this project use them, and two different
    // migrations must never share an id.
    id: 7,
    name: "coach_levels",
    sql: `
      -- A hash of each line Claude wrote, so a commit line can be told apart as AI-written. Never the line.
      CREATE TABLE ai_line_hashes (
        repo_root  TEXT NOT NULL,
        file_path  TEXT NOT NULL,
        hash       TEXT NOT NULL,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (repo_root, file_path, hash)
      );
      CREATE INDEX idx_ai_line_hashes_age ON ai_line_hashes(repo_root, created_at);

      -- Commits Coach has already read. change_id spots the same change after a rebase or cherry-pick.
      CREATE TABLE commits_seen (
        repo_root    TEXT NOT NULL,
        sha          TEXT NOT NULL,
        change_id    TEXT NOT NULL,
        history      INTEGER NOT NULL DEFAULT 0 CHECK (history IN (0, 1)),
        processed_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (repo_root, sha)
      );
      CREATE INDEX idx_commits_seen_change ON commits_seen(repo_root, change_id);

      -- One piece of evidence for or against one ladder item. Paths, symbols and rule ids only, no code.
      CREATE TABLE skill_evidence (
        id              TEXT PRIMARY KEY,
        ladder_id       TEXT NOT NULL,
        item_id         TEXT NOT NULL,
        kind            TEXT NOT NULL CHECK (kind IN ('rule', 'judge', 'decision', 'review', 'ticket_check')),
        polarity        TEXT NOT NULL CHECK (polarity IN ('positive', 'negative')),
        author          TEXT NOT NULL CHECK (author IN ('ai', 'dev', 'unknown')),
        decided_by      TEXT CHECK (decided_by IS NULL OR decided_by IN ('ai', 'dev')),
        owned           INTEGER NOT NULL DEFAULT 0 CHECK (owned IN (0, 1)),
        regresses       INTEGER NOT NULL DEFAULT 0 CHECK (regresses IN (0, 1)),
        history         INTEGER NOT NULL DEFAULT 0 CHECK (history IN (0, 1)),
        repo_root       TEXT,
        commit_sha      TEXT,
        file_path       TEXT,
        symbol          TEXT,
        ticket          TEXT NOT NULL,
        signal_id       TEXT,
        note            TEXT,
        at              TEXT NOT NULL,
        fixed_at        TEXT,
        fixed_ticket    TEXT,
        disagreed_at    TEXT,
        disagree_reason TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_skill_evidence_item ON skill_evidence(ladder_id, item_id);

      -- A coach question, its answer exactly as the developer typed it (saved by the prompt hook), and its rating.
      CREATE TABLE pending_questions (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL CHECK (kind IN ('why', 'explain_back', 'drill')),
        ladder_id      TEXT NOT NULL,
        item_id        TEXT NOT NULL,
        target_ref     TEXT,
        decision_id    TEXT REFERENCES decisions(id) ON DELETE SET NULL,
        ticket         TEXT NOT NULL,
        question       TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        opened_at      TEXT,
        open_session   TEXT,
        answer         TEXT,
        answered_at    TEXT,
        closed_reason  TEXT CHECK (closed_reason IS NULL OR closed_reason IN ('answered', 'later', 'timeout')),
        rating         TEXT CHECK (rating IS NULL OR rating IN ('clear', 'partial', 'not_yet')),
        names_tradeoff INTEGER NOT NULL DEFAULT 0 CHECK (names_tradeoff IN (0, 1)),
        tradeoff_quote TEXT,
        rated_at       TEXT
      );
      CREATE INDEX idx_pending_questions_session ON pending_questions(open_session);

      -- One try at a drill. hits and red_flags are JSON lists of key point ids, never the answer.
      CREATE TABLE drill_attempts (
        id          TEXT PRIMARY KEY,
        ladder_id   TEXT NOT NULL,
        item_id     TEXT NOT NULL,
        drill_id    TEXT NOT NULL,
        question_id TEXT NOT NULL REFERENCES pending_questions(id) ON DELETE CASCADE,
        hits        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hits)),
        red_flags   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(red_flags)),
        passed      INTEGER NOT NULL CHECK (passed IN (0, 1)),
        void        INTEGER NOT NULL DEFAULT 0 CHECK (void IN (0, 1)),
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_drill_attempts_item ON drill_attempts(ladder_id, item_id);

      -- Every change of an item's state, so the developer can see growth over time.
      CREATE TABLE item_state_history (
        id         TEXT PRIMARY KEY,
        ladder_id  TEXT NOT NULL,
        item_id    TEXT NOT NULL,
        from_state TEXT NOT NULL,
        to_state   TEXT NOT NULL,
        reason     TEXT NOT NULL,
        at         TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_item_state_history_item ON item_state_history(ladder_id, item_id);

      -- Coach choices of the developer, for example which tracks to follow.
      CREATE TABLE coach_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL CHECK (json_valid(value))
      );

      -- Best-practice notes the AI wrote once for a stack the ladder does not cover.
      CREATE TABLE stack_notes_local (
        ladder_id  TEXT NOT NULL,
        item_id    TEXT NOT NULL,
        stack_id   TEXT NOT NULL,
        note       TEXT NOT NULL,
        link       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (ladder_id, item_id, stack_id)
      );

      -- The ladder item a decision or an explain-back is about.
      ALTER TABLE decisions ADD COLUMN ladder_id TEXT;
      ALTER TABLE decisions ADD COLUMN item_id TEXT;
      ALTER TABLE explain_backs ADD COLUMN question_id TEXT;
      ALTER TABLE explain_backs ADD COLUMN item_id TEXT;
    `
  },
  {
    id: 8,
    name: "coach_exposure",
    sql: `
      -- A chance to use a skill in the developer's work (for example any call to an outside service), whether or not
      -- the skill was used. Kept apart from evidence: exposure never gives credit and never counts as a fault.
      CREATE TABLE skill_exposure (
        id         TEXT PRIMARY KEY,
        ladder_id  TEXT NOT NULL,
        item_id    TEXT NOT NULL,
        repo_root  TEXT,
        commit_sha TEXT,
        file_path  TEXT,
        symbol     TEXT,
        ticket     TEXT NOT NULL,
        signal_id  TEXT NOT NULL,
        at         TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_skill_exposure_item ON skill_exposure(ladder_id, item_id);
    `
  },
  {
    id: 9,
    name: "coach_ownership_history",
    sql: `
      -- What the developer typed, so a claim "the developer chose this" can be checked against their own words.
      -- Local only. Deleted after 120 days. Slash commands are never saved.
      CREATE TABLE developer_messages (
        id         TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_developer_messages_session ON developer_messages(session_id);

      -- A bug that reached the main branch: the commit that fixed it and the developer's commit that brought it in.
      CREATE TABLE shipped_bugs (
        id            TEXT PRIMARY KEY,
        repo_root     TEXT NOT NULL,
        fix_commit    TEXT NOT NULL,
        origin_commit TEXT NOT NULL,
        ladder_id     TEXT NOT NULL,
        item_id       TEXT NOT NULL,
        signal_id     TEXT NOT NULL,
        file_path     TEXT NOT NULL,
        symbol        TEXT,
        ticket        TEXT NOT NULL,
        at            TEXT NOT NULL,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (repo_root, fix_commit, origin_commit, file_path, signal_id)
      );

      -- The words of the developer that made a decision theirs. Checked against developer_messages.
      ALTER TABLE decisions ADD COLUMN origin_quote TEXT;
    `
  }
];
function migrate(db, list = migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const done = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => r.id)
  );
  const applied = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(m.id, m.name);
    });
    applied.push(m.name);
  }
  return applied;
}

// src/paths.ts
import { isAbsolute, relative, resolve as resolve2, sep } from "node:path";
function toRepoPath(rawPath, root) {
  const path = sep === "/" ? rawPath.replaceAll("\\", "/") : rawPath;
  const absolute = isAbsolute(path) ? path : resolve2(root, path);
  const rel = relative(root, absolute);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  return rel.split(sep).join("/");
}

// src/privacy/denylist.ts
import { readFileSync } from "node:fs";
import { dirname as dirname2, join as join2 } from "node:path";
function defaultDenylistPath() {
  return process.env.FTC_DENYLIST_PATH ?? join2(dirname2(defaultDbPath()), "denylist.txt");
}
function loadDenylist(path = defaultDenylistPath()) {
  const names = [];
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const name = line.trim();
      if (name && !name.startsWith("#")) names.push(name);
    }
  } catch {
  }
  for (const name of (process.env.FTC_DENYLIST ?? "").split(",")) {
    if (name.trim()) names.push(name.trim());
  }
  return names;
}
var LOOKALIKES = {
  \u0430: "a",
  \u0432: "b",
  \u0435: "e",
  \u043A: "k",
  \u043C: "m",
  \u043D: "h",
  \u043E: "o",
  \u0440: "p",
  \u0441: "c",
  \u0442: "t",
  \u0443: "y",
  \u0445: "x",
  \u0456: "i",
  \u0458: "j",
  \u0455: "s",
  \u03B1: "a",
  \u03B2: "b",
  \u03B5: "e",
  \u03B9: "i",
  \u03BA: "k",
  \u03BD: "v",
  \u03BF: "o",
  \u03C1: "p",
  \u03C4: "t",
  \u03C5: "u",
  \u03C7: "x"
};
var LEET_I = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
var LEET_L = { ...LEET_I, "1": "l" };
function squash(text, leet) {
  let out = "";
  for (const ch of text.normalize("NFKD").toLowerCase()) {
    const mapped = LOOKALIKES[ch] ?? leet?.[ch] ?? ch;
    if (/[a-z0-9]/.test(mapped)) out += mapped;
  }
  return out;
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function containsBlockedName(text, names) {
  if (names.length === 0) return false;
  const variants = [squash(text), squash(text, LEET_I), squash(text, LEET_L)];
  const lower = text.normalize("NFKC").toLowerCase();
  for (const name of names) {
    const key = squash(name);
    if (key.length >= 4) {
      if (variants.some((v) => v.includes(key))) return true;
    } else if (key.length > 0) {
      if (new RegExp(`(?<![a-z0-9])${escapeRegExp(name.toLowerCase())}(?![a-z0-9])`).test(lower)) return true;
    }
  }
  return false;
}

// src/store.ts
function recordFileEdit(db, sessionId, filePath) {
  if (!db.prepare("SELECT 1 FROM trail_sessions WHERE session_id = ?").get(sessionId)) {
    return { tracked: false, first: false };
  }
  const row = db.prepare(
    `INSERT INTO file_edits (session_id, file_path) VALUES (?, ?)
       ON CONFLICT(session_id, file_path) DO UPDATE SET edit_count = edit_count + 1, last_edited_at = datetime('now')
       RETURNING edit_count`
  ).get(sessionId, filePath);
  return { tracked: true, first: row.edit_count === 1 };
}

// src/hook/post-tool-use.ts
async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}
async function main() {
  const input = JSON.parse(await readStdin());
  const sessionId = input.session_id;
  const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  if (typeof sessionId !== "string" || typeof file !== "string") return;
  const absolute = isAbsolute2(file) ? file : resolve3(cwd, file);
  let folder = dirname3(absolute);
  while (!existsSync(folder) && dirname3(folder) !== folder) folder = dirname3(folder);
  const repo = repoIdentitySync(folder);
  if (repo === null && !existsSync(defaultDbPath())) return;
  const repoPath = toRepoPath(file, cwd);
  if (repoPath === null) return;
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
      const note = `Paper Trail: first edit to ${repoPath} in this session. If this edit involved a real choice between options, call log_decision with pointer.file_path "${repoPath}". If an earlier decision already covers it, no action is needed now; get_trail lists files with no decision.`;
      process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: note } })
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
