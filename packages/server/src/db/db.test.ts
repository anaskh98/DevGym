import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "./connection.js";
import { randomUUID } from "node:crypto";
import { migrate, migrations } from "./migrations.js";
import { parseTicketMarkdown } from "../tickets/markdown.js";
import { seed } from "./seed.js";

const TABLES = [
  "ai_line_hashes",
  "annotations",
  "assumptions",
  "coach_settings",
  "commits_seen",
  "decisions",
  "developer_messages",
  "drill_attempts",
  "explain_backs",
  "file_edits",
  "growth_plans",
  "item_state_history",
  "observations",
  "pending_questions",
  "pointers",
  "shipped_bugs",
  "skill_evidence",
  "skill_exposure",
  "stack_notes_local",
  "tickets",
  "trail_sessions",
];

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

function addTicket(id = "T-1") {
  db.prepare("INSERT INTO tickets (id, title, body, source) VALUES (?, 't', 'b', 'test')").run(id);
}

describe("migrate", () => {
  it("creates the data model tables", () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => (r as { name: string }).name)
      .filter((n) => n !== "schema_migrations")
      .sort();
    expect(names).toEqual(TABLES);
  });

  it("creates the coach level tables (migration 7)", () => {
    expect(db.prepare("SELECT name FROM schema_migrations WHERE id = 7").get()).toEqual({ name: "coach_levels" });
  });

  it("creates the exposure table (migration 8)", () => {
    expect(db.prepare("SELECT name FROM schema_migrations WHERE id = 8").get()).toEqual({ name: "coach_exposure" });
  });

  it("leaves migration ids 4, 5 and 6 unused", () => {
    expect(migrations.some((m) => m.id === 4 || m.id === 5 || m.id === 6)).toBe(false);
  });

  it("rejects an unknown evidence kind and polarity", () => {
    const insert = (kind: string, polarity: string) =>
      db
        .prepare(
          "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', ?, ?, 'dev', 'T-1', '2026-11-01')",
        )
        .run(randomUUID(), kind, polarity);
    expect(() => insert("rule", "positive")).not.toThrow();
    expect(() => insert("guess", "positive")).toThrow();
    expect(() => insert("rule", "maybe")).toThrow();
  });

  it("does nothing on a second run", () => {
    expect(migrate(db)).toEqual([]);
  });

  it("rolls back a broken migration", () => {
    const broken = { id: 99, name: "broken", sql: "CREATE TABLE half (id TEXT); CREATE TABLE tickets (id TEXT);" };
    expect(() => migrate(db, [broken])).toThrow();
    const half = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get();
    expect(half).toBeUndefined();
  });
});

describe("schema rules", () => {
  it("rejects an unknown assumption status", () => {
    addTicket();
    const insert = db.prepare("INSERT INTO assumptions (id, ticket_id, text, status) VALUES (?, 'T-1', 'x', ?)");
    expect(() => insert.run("a1", "guessed")).toThrow(/CHECK/);
    expect(() => insert.run("a2", "assumed_by_dev")).not.toThrow();
  });

  it("rejects an unknown decision origin and bad JSON", () => {
    addTicket();
    const insert = db.prepare(
      "INSERT INTO decisions (id, ticket_id, session_id, summary, alternatives, origin) VALUES (?, 'T-1', 's', 'x', ?, ?)",
    );
    expect(() => insert.run("d1", "[]", "robot")).toThrow(/CHECK/);
    expect(() => insert.run("d2", "not json", "ai")).toThrow(/CHECK/);
    expect(() => insert.run("d3", '["other way"]', "dev_changed_ai")).not.toThrow();
  });

  it("rejects an unknown explain-back rating", () => {
    addTicket();
    db.prepare("INSERT INTO decisions (id, ticket_id, session_id, summary, origin) VALUES ('d1', 'T-1', 's', 'x', 'ai')").run();
    const insert = db.prepare("INSERT INTO explain_backs (id, decision_id, question, answer, rating) VALUES (?, 'd1', 'q', 'a', ?)");
    expect(() => insert.run("e1", "great")).toThrow(/CHECK/);
    expect(() => insert.run("e2", "not_yet")).not.toThrow();
  });

  it("rejects a decision for a ticket that does not exist", () => {
    const insert = db.prepare("INSERT INTO decisions (id, ticket_id, session_id, summary, origin) VALUES ('d1', 'NOPE', 's', 'x', 'ai')");
    expect(() => insert.run()).toThrow(/FOREIGN KEY/);
  });

  it("deletes a ticket's assumptions and decisions with the ticket", () => {
    addTicket();
    db.prepare("INSERT INTO assumptions (id, ticket_id, text, status) VALUES ('a1', 'T-1', 'x', 'assumed_by_dev')").run();
    db.prepare("INSERT INTO decisions (id, ticket_id, session_id, summary, origin) VALUES ('d1', 'T-1', 's', 'x', 'ai')").run();
    db.prepare("DELETE FROM tickets WHERE id = 'T-1'").run();
    expect(db.prepare("SELECT count(*) AS n FROM assumptions").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT count(*) AS n FROM decisions").get()).toEqual({ n: 0 });
  });
});

describe("seed", () => {
  it("loads the demo ticket", () => {
    expect(seed(db)).toEqual(["SAMPLE-1"]);
    const row = db.prepare("SELECT id, title, source FROM tickets WHERE id = 'SAMPLE-1'").get() as Record<string, string>;
    expect(row.title).toBe("Let customers export their order history");
    expect(row.source).toBe("markdown");
  });

  it("updates instead of duplicating on a second run", () => {
    const dir = mkdtempSync(join(tmpdir(), "ftc-seed-"));
    try {
      writeFileSync(join(dir, "X-1.md"), "---\nid: X-1\ntitle: First\n---\nBody");
      seed(db, dir);
      writeFileSync(join(dir, "X-1.md"), "---\r\nid: X-1\r\ntitle: Second\r\n---\r\nBody");
      seed(db, dir);
      expect(db.prepare("SELECT title FROM tickets").all()).toEqual([{ title: "Second" }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a ticket file with no id", () => {
    expect(() => parseTicketMarkdown("---\ntitle: No id\n---\nBody")).toThrow(/id/);
    expect(() => parseTicketMarkdown("Just text")).toThrow(/front matter/);
  });
});
