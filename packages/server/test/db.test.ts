import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { DATA_TABLES } from "../src/db/migrations";
import { Store } from "../src/db/store";
import { PendingGuard } from "../src/privacy/guard";
import { MarkdownTicketSource } from "../src/tickets/markdown";
import { DEMO_TICKETS_DIR } from "../src/cli/shared";
import { count } from "./helpers";

describe("migrations (BE-2)", () => {
  it("creates all eight data-model tables", () => {
    const db = openDb(":memory:");
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => String(row.name));
    expect(DATA_TABLES).toHaveLength(8);
    for (const table of DATA_TABLES) expect(tables).toContain(table);
  });

  it("is idempotent", () => {
    const db = openDb(":memory:");
    expect(migrate(db)).toEqual(["init_data_model"]);
    expect(migrate(db)).toEqual([]);
  });

  it("enforces the status, origin and rating values in the schema", () => {
    const db = openDb(":memory:");
    migrate(db);
    db.exec(
      "INSERT INTO tickets VALUES ('T-1', 't', 'b', 'markdown', '2026-01-01', '2026-01-01')",
    );
    expect(() =>
      db.exec(
        "INSERT INTO assumptions VALUES ('a', 'T-1', 'r', 0, 'q', '[]', 'guessed', 'x', '2026-01-01')",
      ),
    ).toThrow();
    expect(() =>
      db.exec(
        "INSERT INTO decisions VALUES ('d', 'T-1', 's', 'x', '[]', 'robot', NULL, '2026-01-01')",
      ),
    ).toThrow();
  });

  it("removes a ticket's assumptions and decisions with the ticket", () => {
    const db = openDb(":memory:");
    migrate(db);
    const store = new Store(db, { guard: new PendingGuard() });
    store.upsertTicket({ id: "T-1", title: "t", body: "b", source: "markdown" });
    store.saveAssumptions("T-1", [
      { text: "q", readings: ["a", "b"], status: "assumed_by_dev", answer: "a" },
    ]);
    store.logDecision({ ticket_id: "T-1", session_id: "s", summary: "x", alternatives: [], origin: "ai" });
    db.exec("DELETE FROM tickets WHERE id = 'T-1'");
    expect(count(db, "assumptions")).toBe(0);
    expect(count(db, "decisions")).toBe(0);
  });
});

describe("seed (BE-2)", () => {
  it("loads the demo ticket from the demo repo", async () => {
    const db = openDb(":memory:");
    migrate(db);
    const store = new Store(db, { guard: new PendingGuard() });
    const source = new MarkdownTicketSource(DEMO_TICKETS_DIR);
    for (const ticket of await source.list()) {
      store.upsertTicket({ ...ticket, source: source.name });
    }
    const demo = store.getTicket("DEMO-1");
    expect(demo?.title).toBe("Let members cancel a booking");
    expect(demo?.source).toBe("markdown");
    expect(demo?.body).toContain("up to 24 hours before it starts");
  });
});
