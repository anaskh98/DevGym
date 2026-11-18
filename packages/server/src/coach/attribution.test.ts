import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { aiHashesFor, firstHashAt, lineHash, linesFromToolInput, normalizeLine, pruneAiLines, saveAiLines } from "./attribution.js";

let db: Db;
beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

describe("normalizeLine and lineHash", () => {
  it("hashes lines the same across formatting and Windows line endings (Review Focus 4)", () => {
    expect(normalizeLine("  const a = 'x';\r")).toBe(normalizeLine('const a = "x"'));
    expect(normalizeLine("const a = `x`;")).toBe(normalizeLine('const a = "x"'));
    expect(lineHash(normalizeLine("call(a, b),")!)).toBe(lineHash(normalizeLine("call(a,b)")!));
  });

  it("skips lines shorter than 4 characters after cleaning", () => {
    expect(normalizeLine("  });")).toBeNull();
    expect(normalizeLine("}")).toBeNull();
    expect(normalizeLine("")).toBeNull();
  });

  it("gives 16 hex characters", () => {
    expect(lineHash("abcd")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("linesFromToolInput", () => {
  it("reads the written lines from each edit tool", () => {
    expect(linesFromToolInput("Edit", { new_string: "a\nb" })).toEqual(["a", "b"]);
    expect(linesFromToolInput("MultiEdit", { edits: [{ new_string: "a\nb" }, { new_string: "c" }] })).toEqual(["a", "b", "c"]);
    expect(linesFromToolInput("Write", { content: "x\r\ny" })).toEqual(["x", "y"]);
    expect(linesFromToolInput("NotebookEdit", { new_source: "z" })).toEqual(["z"]);
  });

  it("reads nothing from other tools or bad input", () => {
    expect(linesFromToolInput("Bash", { command: "echo" })).toEqual([]);
    expect(linesFromToolInput("Edit", null)).toEqual([]);
    expect(linesFromToolInput("MultiEdit", { edits: "nope" })).toEqual([]);
  });
});

describe("AI line storage", () => {
  it("saves, finds, and prunes AI line hashes", () => {
    const saved = saveAiLines(db, "C:/repo", "src/pay.ts", "s1", ["const timeout = 5000;", "  }", "const timeout = 5000;"]);
    expect(saved).toBe(1); // the short line is skipped, the repeat is stored once
    const hashes = aiHashesFor(db, "C:/repo", "src/pay.ts");
    expect(hashes.has(lineHash(normalizeLine("const timeout = 5000")!))).toBe(true);
    expect(aiHashesFor(db, "C:/repo", "src/other.ts").size).toBe(0);
    expect(firstHashAt(db, "C:/repo")).not.toBeNull();
    expect(firstHashAt(db, "C:/elsewhere")).toBeNull();

    expect(pruneAiLines(db, 120, new Date(Date.now() + 121 * 86_400_000))).toBe(1);
    expect(aiHashesFor(db, "C:/repo", "src/pay.ts").size).toBe(0);
  });

  it("keeps hashes younger than the limit", () => {
    saveAiLines(db, "C:/repo", "src/pay.ts", "s1", ["const timeout = 5000;"]);
    expect(pruneAiLines(db, 120, new Date(Date.now() + 10 * 86_400_000))).toBe(0);
  });
});
