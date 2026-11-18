// Who wrote a line: the edit hook saves a hash of every line Claude writes. A commit line whose hash matches is
// AI-written; any other line is the developer's. Only hashes are stored, never the line.
import { createHash } from "node:crypto";
import type { Db } from "../db/connection.js";

/**
 * Cleans a line so a formatter does not turn an AI line into a developer line: all whitespace removed,
 * ' and ` turned into ", one trailing , or ; dropped. Returns null for lines too short to tell apart.
 */
export function normalizeLine(line: string): string | null {
  let s = line.replace(/\s+/g, "").replace(/['`]/g, '"');
  if (s.endsWith(",") || s.endsWith(";")) s = s.slice(0, -1);
  return s.length >= 4 ? s : null;
}

export function lineHash(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

function linesOf(value: unknown): string[] {
  return typeof value === "string" ? value.split(/\r?\n/) : [];
}

/** The lines an edit tool wrote, from the hook's tool_input. */
export function linesFromToolInput(toolName: string, toolInput: unknown): string[] {
  if (typeof toolInput !== "object" || toolInput === null) return [];
  const input = toolInput as Record<string, unknown>;
  switch (toolName) {
    case "Edit":
      return linesOf(input.new_string);
    case "Write":
      return linesOf(input.content);
    case "NotebookEdit":
      return linesOf(input.new_source);
    case "MultiEdit":
      return Array.isArray(input.edits)
        ? input.edits.flatMap((e) => (typeof e === "object" && e !== null ? linesOf((e as Record<string, unknown>).new_string) : []))
        : [];
    default:
      return [];
  }
}

/** Saves the hashes of lines Claude wrote. Returns how many new hashes were stored. */
export function saveAiLines(db: Db, repoRoot: string, filePath: string, sessionId: string, lines: string[]): number {
  const insert = db.prepare("INSERT OR IGNORE INTO ai_line_hashes (repo_root, file_path, hash, session_id) VALUES (?, ?, ?, ?)");
  let stored = 0;
  for (const line of lines) {
    const normalized = normalizeLine(line);
    if (normalized === null) continue;
    stored += Number(insert.run(repoRoot, filePath, lineHash(normalized), sessionId).changes);
  }
  return stored;
}

export function aiHashesFor(db: Db, repoRoot: string, filePath: string): Set<string> {
  const rows = db.prepare("SELECT hash FROM ai_line_hashes WHERE repo_root = ? AND file_path = ?").all(repoRoot, filePath) as { hash: string }[];
  return new Set(rows.map((r) => r.hash));
}

/** When Claude first wrote a line in this repo, as ISO 8601 UTC, or null if never. */
export function firstHashAt(db: Db, repoRoot: string): string | null {
  const row = db.prepare("SELECT MIN(created_at) AS first FROM ai_line_hashes WHERE repo_root = ?").get(repoRoot) as { first: string | null };
  return row.first ? `${row.first.replace(" ", "T")}Z` : null;
}

/** SQLite's datetime('now') format, in UTC. */
export function sqliteTime(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

/** Deletes hashes older than keepDays. Returns how many were deleted. */
export function pruneAiLines(db: Db, keepDays: number, now: Date = new Date()): number {
  const cutoff = sqliteTime(new Date(now.getTime() - keepDays * 86_400_000));
  return Number(db.prepare("DELETE FROM ai_line_hashes WHERE created_at < ?").run(cutoff).changes);
}
