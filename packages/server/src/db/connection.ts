import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite is built into Node 22+. No native library to install, so the server bundles into one file.
export type Db = DatabaseSync;

/** Profile data lives in the developer's home folder, never inside a repo. */
export function defaultDbPath(): string {
  return process.env.FTC_DB_PATH ?? join(homedir(), ".fork-trail-coach", "profile.sqlite");
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout: the MCP server and the web API may have the file open at the same time.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  return db;
}

/** Runs fn inside one transaction: all of its writes land, or none do. */
export function transaction<T>(db: Db, fn: () => T): T {
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
