import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite is built into Node 22+. No native library to install, so the server bundles into one file.
export type Db = DatabaseSync;

/** Profile data lives in the developer's home folder, never inside a repo. */
export function defaultDbPath(): string {
  if (process.env.DEVGYM_DB_PATH) return process.env.DEVGYM_DB_PATH;
  const dir = join(homedir(), ".devgym");
  carryOverLegacyFolder(dir, join(homedir(), ".fork-trail-coach"));
  return join(dir, "profile.sqlite");
}

let carriedOver = false;

/**
 * Before the rename to DevGym the data lived in ~/.fork-trail-coach. The first time the new folder is
 * needed and does not exist yet, the old one is copied across (database, denylist, eval results, ladder),
 * so nobody loses their tickets, decisions or levels. The old folder is left as it was.
 */
export function carryOverLegacyFolder(dir: string, legacy: string): void {
  if (carriedOver) return;
  carriedOver = true;
  if (existsSync(dir) || !existsSync(legacy)) return;
  try {
    cpSync(legacy, dir, { recursive: true });
  } catch {
    // A copy that fails leaves an empty start, the same as a new install. The old folder is untouched.
  }
}

/** Tests only: let carryOverLegacyFolder run again. */
export function resetCarryOver(): void {
  carriedOver = false;
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
