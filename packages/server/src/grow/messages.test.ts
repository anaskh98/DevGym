import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { pruneMessages, quoteInSession, saveMessage } from "./messages.js";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

describe("developer messages", () => {
  it("saves messages, never slash commands, and finds a real quote in the same session only", () => {
    saveMessage(db, "s1", "No, use a queue for the retries instead of looping in the handler");
    saveMessage(db, "s1", "/grow");
    expect(quoteInSession(db, "s1", "use a queue for the retries")).toBe(true);
    expect(quoteInSession(db, "s2", "use a queue for the retries")).toBe(false);
    expect(quoteInSession(db, "s1", "use a stack for the retries")).toBe(false);
    expect(quoteInSession(db, "s1", "/grow")).toBe(false);
    expect(db.prepare("SELECT count(*) AS n FROM developer_messages").get()).toEqual({ n: 1 });
  });
  it("needs a quote of at least 12 characters", () => {
    saveMessage(db, "s1", "use a queue");
    expect(quoteInSession(db, "s1", "use a queue")).toBe(false);
  });
  it("deletes messages older than 120 days", () => {
    db.prepare("INSERT INTO developer_messages (id, session_id, message, created_at) VALUES ('o', 's1', 'old message here', '2026-01-01 00:00:00')").run();
    saveMessage(db, "s1", "a fresh message here");
    expect(pruneMessages(db, 120, new Date("2026-11-19T00:00:00Z"))).toBe(1);
  });
});
