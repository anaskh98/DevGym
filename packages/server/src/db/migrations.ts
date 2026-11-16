import { transaction, type Db } from "./connection.js";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/**
 * Migrations are append-only. Never edit one that has shipped: add a new one.
 * They live in code (not .sql files) so the server can be bundled into the plugin.
 */
export const migrations: Migration[] = [
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
    `,
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
    `,
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
    `,
  },
];

/** Applies every migration not yet applied. Safe to run many times. Returns the names applied. */
export function migrate(db: Db, list: Migration[] = migrations): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const done = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((r) => (r as { id: number }).id),
  );
  const applied: string[] = [];
  for (const m of [...list].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue;
    // One transaction per migration: a failed migration leaves no half-made tables.
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (id, name) VALUES (?, ?)").run(m.id, m.name);
    });
    applied.push(m.name);
  }
  return applied;
}
