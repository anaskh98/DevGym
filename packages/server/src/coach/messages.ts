// What the developer typed, kept locally, so a claim that "the developer chose this" can be checked against it.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { sqliteTime } from "./attribution.js";
import { quoteIn } from "./quote.js";

/** Saves a message. Slash commands are commands, not decisions, so they are never saved. */
export function saveMessage(db: Db, sessionId: string, message: string): void {
  const text = message.trim();
  if (text === "" || text.startsWith("/")) return;
  db.prepare("INSERT INTO developer_messages (id, session_id, message) VALUES (?, ?, ?)").run(randomUUID(), sessionId, text);
}

export function pruneMessages(db: Db, keepDays: number, now: Date = new Date()): number {
  const cutoff = sqliteTime(new Date(now.getTime() - keepDays * 86_400_000));
  return Number(db.prepare("DELETE FROM developer_messages WHERE created_at < ?").run(cutoff).changes);
}

/** Is the quote (12+ characters) really in a message the developer sent in this session? */
export function quoteInSession(db: Db, sessionId: string, quote: string): boolean {
  const rows = db.prepare("SELECT message FROM developer_messages WHERE session_id = ?").all(sessionId) as { message: string }[];
  return rows.some((r) => quoteIn(r.message, quote));
}

/** The origin that is stored: dev origins stay only with a quote the server can find, else they become ai. */
export function resolveOrigin(
  db: Db,
  sessionId: string,
  origin: "ai" | "dev" | "dev_changed_ai",
  quote: string | undefined,
): { origin: "ai" | "dev" | "dev_changed_ai"; quote: string | null; note?: string } {
  if (origin === "ai") return { origin, quote: null };
  if (quote === undefined) return { origin: "ai", quote: null, note: "Stored as an AI choice: a developer choice needs origin_quote, the developer's own words." };
  if (!quoteInSession(db, sessionId, quote)) {
    return { origin: "ai", quote: null, note: "Stored as an AI choice: those words are not in a message the developer sent in this session." };
  }
  return { origin, quote };
}

/** A positive piece of evidence from a decision. It counts for the developer only when they made the decision. */
export function decisionEvidence(
  db: Db,
  d: { ladder_id: string; item_id: string; ticket: string; decided_by: "ai" | "dev"; file: string | null; symbol: string | null },
): void {
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, decided_by, ticket, file_path, symbol, at) VALUES (?, ?, ?, 'decision', 'positive', 'unknown', ?, ?, ?, ?, ?)",
  ).run(randomUUID(), d.ladder_id, d.item_id, d.decided_by, d.ticket, d.file, d.symbol, new Date().toISOString());
}
