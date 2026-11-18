// The developer's Coach choices, stored on this machine: which tracks to follow, and extra commit emails.
import type { Db } from "../db/connection.js";
import { TRACKS, type Track } from "./ladder/schema.js";

function read<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM coach_settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : fallback;
}

function write(db: Db, key: string, value: unknown): void {
  db.prepare("INSERT INTO coach_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}

export function getTracks(db: Db): Track[] {
  return read<string[]>(db, "tracks", []).filter((t): t is Track => (TRACKS as readonly string[]).includes(t));
}

export function setTracks(db: Db, tracks: Track[]): void {
  write(db, "tracks", [...new Set(tracks)]);
}

export function getExtraEmails(db: Db): string[] {
  return read<string[]>(db, "extra_emails", []);
}

export function setExtraEmails(db: Db, emails: string[]): void {
  write(db, "extra_emails", [...new Set(emails.map((e) => e.trim().toLowerCase()))]);
}
