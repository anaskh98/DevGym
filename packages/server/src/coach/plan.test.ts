import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { loadLadder } from "./ladder/load.js";
import { buildFrame, checkItemArea, pickFocus, saveStackNote } from "./plan.js";
import type { StackHit } from "./stack.js";
import { computeStatuses } from "./status.js";

let db: Db;
const loaded = loadLadder("backend", { repoRoot: "/nowhere", home: "/nowhere" });
const NOW = new Date("2026-11-18T12:00:00Z");
const stacks: StackHit[] = [
  { stack_id: "express", track: "backend", folder: "api" },
  { stack_id: "fastify", track: "backend", folder: "jobs" },
];

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

function row(itemId: string, o: { polarity?: string; signal?: string; file?: string; symbol?: string; ticket?: string; at?: string; fixed?: boolean } = {}): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at, fixed_at, fixed_ticket) VALUES (?, 'builtin/backend', ?, 'rule', ?, 'dev', ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    itemId,
    o.polarity ?? "positive",
    o.ticket ?? "T-1",
    o.signal ?? "err.timeout-set",
    o.file ?? "api/src/pay.ts",
    o.symbol ?? `f${id.slice(0, 4)}`,
    o.at ?? "2026-11-10T10:00:00Z",
    o.fixed ? "2026-11-11T10:00:00Z" : null,
    o.fixed ? "T-9" : null,
  );
  return id;
}
function shown(itemId: string) {
  row(itemId, { ticket: "T-1" });
  row(itemId, { ticket: "T-1" });
  row(itemId, { ticket: "T-2" });
  const answer = db.prepare(
    "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, answer, answered_at, closed_reason, rating, names_tradeoff) VALUES (?, 'why', 'builtin/backend', ?, ?, 'a', '2026-11-11T10:00:00Z', 'answered', 'clear', ?)",
  );
  answer.run(randomUUID(), itemId, "T-1", 1);
  answer.run(randomUUID(), itemId, "T-2", 0);
}
const results = () => [{ loaded, statuses: computeStatuses(db, loaded, NOW) }];

describe("pickFocus", () => {
  it("puts an open fault first, then a shown item, then learning items by proofs", () => {
    row("BE.ERR.J1", { polarity: "negative", signal: "err.empty-catch" });
    shown("BE.ERR.J2");
    row("BE.ERR.M2");
    const picked = pickFocus(results(), { recentFaultItems: new Set(["BE.ERR.J1"]), workedAreas: new Set(["builtin/backend:ERR"]) }, 3);
    expect(picked.map((p) => p.status.item_id)).toEqual(["BE.ERR.J1", "BE.ERR.J2", "BE.ERR.M2"]);
  });

  it("never picks from an area the developer has no evidence in", () => {
    row("BE.ERR.M2");
    expect(pickFocus(results(), { recentFaultItems: new Set(), workedAreas: new Set() }, 3)).toEqual([]);
  });

  it("skips items more than one level above the level being worked on", () => {
    row("BE.ERR.S1");
    const picked = pickFocus(results(), { recentFaultItems: new Set(), workedAreas: new Set(["builtin/backend:ERR"]) }, 3);
    expect(picked.map((p) => p.status.item_id)).not.toContain("BE.ERR.S1");
  });
});

describe("buildFrame", () => {
  it("uses the open fault as the spot, the stack of its folder, and the ladder note", () => {
    row("BE.ERR.M2", { file: "api/src/pay.ts", symbol: "charge" });
    row("BE.ERR.M2", { polarity: "negative", signal: "err.empty-catch", file: "api/src/refund.ts", symbol: "refund", at: "2026-11-09T10:00:00Z" });
    const status = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    const frame = buildFrame(db, status, { ladder: loaded, stacks });
    expect(frame.spot).toEqual({ file: "api/src/refund.ts", symbol: "refund" });
    expect(frame.stack).toBe("express");
    expect(frame.stack_note?.source).toBe("ladder");
    expect(frame.study.length).toBeGreaterThan(1);
    expect(frame.evidence_ids.length).toBe(2);
  });

  it("has no note for a stack the ladder lacks, until one is saved locally", () => {
    row("BE.ERR.M2", { file: "jobs/run.ts", symbol: "run" });
    const status = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    expect(buildFrame(db, status, { ladder: loaded, stacks }).stack_note).toBeNull();
    saveStackNote(db, loaded, { item_id: "BE.ERR.M2", stack_id: "fastify", note: "Use the request timeout option of undici.", link: "https://fastify.dev/docs/latest/" });
    expect(buildFrame(db, status, { ladder: loaded, stacks }).stack_note).toMatchObject({ source: "local", note: "Use the request timeout option of undici." });
  });

  it("refuses a local note for a stack the ladder already covers, or a plain http link", () => {
    expect(() => saveStackNote(db, loaded, { item_id: "BE.ERR.M2", stack_id: "express", note: "x note here", link: "https://a.b" })).toThrow(/already has a note/);
    expect(() => saveStackNote(db, loaded, { item_id: "BE.ERR.M2", stack_id: "koa", note: "x note here", link: "http://a.b" })).toThrow(/https/);
  });
});

describe("checkItemArea", () => {
  it("needs evidence of that item and an exercise that names the spot file", () => {
    const own = row("BE.ERR.M2", { file: "api/src/pay.ts", symbol: "charge" });
    const other = row("BE.ERR.M3", { signal: "err.error-cause" });
    const base = { item_id: "BE.ERR.M2", ladder_id: "builtin/backend", spot: { file: "api/src/pay.ts", symbol: "charge" } };
    expect(() => checkItemArea(db, { ...base, evidence_ids: [own], exercise_kind: "implement", exercise: "In the payment code, add a time limit." })).toThrow(/pay\.ts/);
    expect(() => checkItemArea(db, { ...base, evidence_ids: [other], exercise_kind: "implement", exercise: "In pay.ts add a time limit." })).toThrow(/not evidence for BE\.ERR\.M2/);
    expect(() => checkItemArea(db, { ...base, evidence_ids: [own], exercise_kind: "implement", exercise: "In pay.ts, add a time limit to charge." })).not.toThrow();
  });

  it("allows the next ticket instead of a spot", () => {
    const own = row("BE.ERR.M2");
    expect(() => checkItemArea(db, { item_id: "BE.ERR.M2", ladder_id: "builtin/backend", evidence_ids: [own], exercise_kind: "implement", exercise: "On your next ticket, set a time limit on every outside call." })).not.toThrow();
    expect(() => checkItemArea(db, { item_id: "BE.ERR.M2", ladder_id: "builtin/backend", evidence_ids: [own], exercise_kind: "implement", exercise: "Study timeouts." })).toThrow(/spot|ticket/);
  });
});

describe("stage 1.5: why it matters, exercise kinds, study rule", () => {
  it("puts why it matters and the exercise kinds in the frame", () => {
    row("BE.ERR.M2", { file: "api/src/pay.ts", symbol: "charge" });
    const status = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    const frame = buildFrame(db, status, { ladder: loaded, stacks });
    expect(frame.why_it_matters.length).toBeGreaterThan(10);
    expect(frame.exercise_kinds).toContain("design_tradeoff");
  });

  it("gives study topics only for a learning item", () => {
    row("BE.ERR.M2", { file: "api/src/pay.ts", symbol: "charge" });
    const notAssessed = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    expect(notAssessed.state).toBe("not_assessed");
    expect(buildFrame(db, notAssessed, { ladder: loaded, stacks }).study).toEqual([]);
    row("BE.ERR.M2", { polarity: "negative", signal: "err.empty-catch", file: "api/src/pay.ts", symbol: "charge" });
    const learning = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    expect(learning.state).toBe("learning");
    expect(buildFrame(db, learning, { ladder: loaded, stacks }).study.length).toBeGreaterThan(1);
  });

  it("refuses an exercise kind the item does not allow, or none", () => {
    const own = row("BE.ERR.M2");
    const base = { item_id: "BE.ERR.M2", ladder_id: "builtin/backend", evidence_ids: [own], exercise: "On your next ticket, set a time limit." };
    expect(() => checkItemArea(db, { ...base, exercise_kind: "debug" }, ["implement", "design_tradeoff"])).toThrow(/debug/);
    expect(() => checkItemArea(db, base)).toThrow(/exercise_kind/);
  });

  it("accepts a design trade-off exercise with no spot and no ticket", () => {
    const own = row("BE.ERR.M2");
    expect(() =>
      checkItemArea(db, { item_id: "BE.ERR.M2", ladder_id: "builtin/backend", evidence_ids: [own], exercise_kind: "design_tradeoff", exercise: "Write down when a payment call may be retried, and what each choice costs." }),
    ).not.toThrow();
  });
});

describe("stage 1.5 review fixes: study after a failed drill (I5)", () => {
  it("gives study topics to a shown item whose latest drill failed", () => {
    shown("BE.ERR.M2");
    const q = randomUUID();
    db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, answer, answered_at, closed_reason) VALUES (?, 'drill', 'builtin/backend', 'BE.ERR.M2', 'drill', 'x', '2026-11-15T10:00:00Z', 'answered')").run(q);
    db.prepare("INSERT INTO drill_attempts (id, ladder_id, item_id, drill_id, question_id, passed, created_at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'd1', ?, 0, '2026-11-15T10:00:00Z')").run(randomUUID(), q);
    const status = computeStatuses(db, loaded, NOW).get("BE.ERR.M2")!;
    expect(status.state).toBe("shown");
    expect(buildFrame(db, status, { ladder: loaded, stacks }).study.length).toBeGreaterThan(1);
  });
});
