/**
 * Schema migrations, in order. Never edit a migration that has shipped;
 * add a new one.
 *
 * They live in TypeScript (not .sql files) so the server bundles into a
 * single file for the plugin.
 */
export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "init_data_model",
    sql: `
      CREATE TABLE tickets (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        source      TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE assumptions (
        id          TEXT PRIMARY KEY,
        ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        run_id      TEXT NOT NULL,
        position    INTEGER NOT NULL,
        text        TEXT NOT NULL,
        readings    TEXT NOT NULL DEFAULT '[]',
        status      TEXT NOT NULL CHECK (status IN ('answered_by_po', 'assumed_by_dev')),
        answer      TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_assumptions_ticket_run ON assumptions(ticket_id, run_id, position);

      -- Code is referenced by pointer, never copied.
      CREATE TABLE pointers (
        id          TEXT PRIMARY KEY,
        repo        TEXT,
        pr_number   INTEGER,
        file_path   TEXT NOT NULL,
        symbol      TEXT,
        commit_sha  TEXT,
        line_hint   INTEGER,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE decisions (
        id            TEXT PRIMARY KEY,
        ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        session_id    TEXT NOT NULL,
        summary       TEXT NOT NULL,
        alternatives  TEXT NOT NULL DEFAULT '[]',
        origin        TEXT NOT NULL CHECK (origin IN ('ai', 'dev', 'dev_changed_ai')),
        pointer_id    TEXT REFERENCES pointers(id) ON DELETE SET NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_decisions_ticket ON decisions(ticket_id, created_at);
      CREATE INDEX idx_decisions_session ON decisions(session_id);

      CREATE TABLE explain_backs (
        id           TEXT PRIMARY KEY,
        decision_id  TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
        question     TEXT NOT NULL,
        answer       TEXT NOT NULL,
        rating       TEXT NOT NULL CHECK (rating IN ('clear', 'partial', 'not_yet')),
        created_at   TEXT NOT NULL
      );
      CREATE INDEX idx_explain_backs_decision ON explain_backs(decision_id);

      CREATE TABLE observations (
        id            TEXT PRIMARY KEY,
        developer_id  TEXT NOT NULL,
        skill_tag     TEXT NOT NULL,
        summary       TEXT NOT NULL,
        evidence_ids  TEXT NOT NULL DEFAULT '[]',
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_observations_developer ON observations(developer_id, created_at);

      CREATE TABLE growth_plans (
        id            TEXT PRIMARY KEY,
        developer_id  TEXT NOT NULL,
        focus_areas   TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE INDEX idx_growth_plans_developer ON growth_plans(developer_id, created_at);

      CREATE TABLE annotations (
        id          TEXT PRIMARY KEY,
        target_id   TEXT NOT NULL,
        note        TEXT NOT NULL,
        disagrees   INTEGER NOT NULL DEFAULT 0 CHECK (disagrees IN (0, 1)),
        created_at  TEXT NOT NULL
      );
      CREATE INDEX idx_annotations_target ON annotations(target_id);
    `,
  },
];

/** The eight data-model tables, for checks and for "delete all" (BE-12). */
export const DATA_TABLES = [
  "tickets",
  "assumptions",
  "pointers",
  "decisions",
  "explain_backs",
  "observations",
  "growth_plans",
  "annotations",
] as const;
