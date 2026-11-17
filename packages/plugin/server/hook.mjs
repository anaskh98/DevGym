import { createRequire as __ftcCreateRequire } from 'node:module';
const require = __ftcCreateRequire(import.meta.url);

// src/hook/post-tool-use.ts
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
import { isAbsolute, relative, resolve, sep } from "node:path";
function toRepoPath(rawPath, root) {
  const path = sep === "/" ? rawPath.replaceAll("\\", "/") : rawPath;
  const absolute = isAbsolute(path) ? path : resolve(root, path);
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
  if (!existsSync(defaultDbPath())) return;
  const repoPath = toRepoPath(file, cwd);
  if (repoPath === null) return;
  if (containsBlockedName(repoPath, loadDenylist())) return;
  const db = openDb();
  try {
    migrate(db);
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
