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
    `,
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
    `,
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
