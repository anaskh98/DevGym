import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { exposureFor } from "./exposure.js";
import { DEFAULT_THRESHOLDS as T } from "./ladder/schema.js";

let db: Db;
const NOW = new Date("2026-11-18T12:00:00Z");
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

function chance(symbol: string, at = "2026-11-10T10:00:00Z") {
  db.prepare("INSERT INTO skill_exposure (id, ladder_id, item_id, file_path, symbol, ticket, signal_id, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'src/a.ts', ?, 'T-1', 'io.outside-call', ?)").run(randomUUID(), symbol, at);
}
const level = () => exposureFor(db, "builtin/backend", "BE.ERR.M2", NOW, T);

describe("exposureFor", () => {
  it("is none with no chances", () => expect(level()).toEqual({ level: "none", functions: 0 }));
  it("is low from 1 function", () => {
    chance("a");
    chance("a");
    expect(level()).toEqual({ level: "low", functions: 1 });
  });
  it("is medium from 3 and high from 6 functions", () => {
    for (const s of ["a", "b", "c"]) chance(s);
    expect(level().level).toBe("medium");
    for (const s of ["d", "e", "f"]) chance(s);
    expect(level().level).toBe("high");
  });
  it("counts rule evidence of the item as a chance too", () => {
    db.prepare("INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'rule', 'positive', 'dev', 'T-1', 'err.timeout-set', 'src/a.ts', 'z', '2026-11-10T10:00:00Z')").run(randomUUID());
    chance("z");
    expect(level()).toEqual({ level: "low", functions: 1 });
  });
  it("ignores chances older than 90 days", () => {
    chance("old", "2026-07-01T10:00:00Z");
    expect(level().level).toBe("none");
  });
});
