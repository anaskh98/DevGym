import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../src/db/connection";
import { migrate } from "../src/db/migrate";
import { Store } from "../src/db/store";
import {
  PendingGuard,
  type GuardInput,
  type GuardVerdict,
  type PrivacyGuard,
} from "../src/privacy/guard";

/** Records every check; rejects when `reject` is set. */
export class SpyGuard implements PrivacyGuard {
  readonly name = "spy";
  readonly seen: GuardInput[] = [];
  reject = false;

  check(input: GuardInput): GuardVerdict {
    this.seen.push(input);
    return this.reject
      ? { ok: false, rule: "test-rule", field: Object.keys(input.fields)[0] ?? "?", reason: "blocked by test" }
      : { ok: true };
  }
}

export function memoryStore(guard: PrivacyGuard = new PendingGuard()): { db: Db; store: Store } {
  const db = openDb(":memory:");
  migrate(db);
  return { db, store: new Store(db, { guard }) };
}

export const TICKET = {
  id: "T-1",
  title: "A ticket",
  body: "Do the thing.",
  source: "markdown",
};

export async function ticketsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ftc-tickets-"));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

export function count(db: Db, table: string): number {
  return Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
}
