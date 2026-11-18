import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { drillGate, drillsReady, pickDrill, scoreDrill, startDrill } from "./drills.js";
import { factsForItem } from "./facts.js";
import { findItem, loadLadder } from "./ladder/load.js";
import { DEFAULT_THRESHOLDS as T } from "./ladder/schema.js";
import { captureAnswer } from "./questions.js";
import { itemStatus, type DrillFact, type ItemStatus } from "./state.js";
import { disagree } from "./status.js";

let db: Db;
const loaded = loadLadder("backend", { repoRoot: "/nowhere", home: "/nowhere" });
const item = findItem(loaded.ladder, "BE.ERR.M2")!.item;
const ctx = { loaded, item };
const NOW = new Date("2026-11-18T12:00:00Z");

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});
afterEach(() => db.close());

/** Makes BE.ERR.M2 Shown: 3 developer proofs on 2 tickets and 2 clear answers, one naming the trade-off. */
function makeShown() {
  const proof = db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', 'BE.ERR.M2', 'rule', 'positive', 'dev', ?, 'err.timeout-set', 'src/pay.ts', ?, '2026-11-10T10:00:00Z')",
  );
  proof.run(randomUUID(), "T-1", "a");
  proof.run(randomUUID(), "T-1", "b");
  proof.run(randomUUID(), "T-2", "c");
  const answer = db.prepare(
    "INSERT INTO pending_questions (id, kind, ladder_id, item_id, ticket, answer, answered_at, closed_reason, rating, names_tradeoff) VALUES (?, 'why', 'builtin/backend', 'BE.ERR.M2', ?, 'a', '2026-11-11T10:00:00Z', 'answered', 'clear', ?)",
  );
  answer.run(randomUUID(), "T-1", 1);
  answer.run(randomUUID(), "T-2", 0);
}
const status = (now = NOW) => itemStatus({ item, ...factsForItem(db, "builtin/backend", "BE.ERR.M2") }, now, T);
const keyText = (id: string) => item.drills[0]!.key_points.find((k) => k.id === id)!.text;

/** Starts a drill and saves an answer made of the given parts. */
function drillAnswered(answer: string, now = NOW) {
  const started = startDrill(db, ctx, { session_id: "s1" }, now);
  captureAnswer(db, "s1", answer, new Date(now.getTime() + 60_000));
  return started;
}
const GOOD =
  "Set a time limit shorter than the caller's own. Retry only with an idempotency key so the card is never charged twice. Use backoff with jitter and a cap. If it still fails, return a pending state.";

describe("drillGate", () => {
  const s = (state: ItemStatus["state"]) => ({ state }) as ItemStatus;
  const failed: DrillFact = { id: "x", drill_id: "d1", passed: false, void: false, at: "2026-11-18T10:00:00Z" };
  it("allows a drill only when the item is shown", () => {
    const out = drillGate(s("learning"), [], 0, NOW, T);
    expect(out.allowed).toBe(false);
    expect(out.allowed ? "" : out.reason).toMatch(/Shown/);
    expect(drillGate(s("shown"), [], 0, NOW, T).allowed).toBe(true);
  });
  it("waits after a failed drill: one new proof or 3 days", () => {
    expect(drillGate(s("shown"), [failed], 0, NOW, T).allowed).toBe(false);
    expect(drillGate(s("shown"), [failed], 1, NOW, T).allowed).toBe(true);
    expect(drillGate(s("shown"), [failed], 0, new Date("2026-11-21T11:00:00Z"), T).allowed).toBe(true);
  });
});

describe("pickDrill", () => {
  it("never repeats a drill until all were used, then returns the oldest", () => {
    const at = (d: string, when: string): DrillFact => ({ id: d + when, drill_id: d, passed: false, void: false, at: when });
    expect(pickDrill(item, []).id).toBe("d1");
    expect(pickDrill(item, [at("d1", "2026-11-01T00:00:00Z")]).id).toBe("d2");
    expect(pickDrill(item, [at("d1", "2026-11-05T00:00:00Z"), at("d2", "2026-11-03T00:00:00Z")]).id).toBe("d2");
  });
});

describe("startDrill and scoreDrill", () => {
  it("refuses to start before the item is shown", () => {
    expect(() => startDrill(db, ctx, { session_id: "s1" }, NOW)).toThrow(/Shown/);
  });

  it("passes with enough real quotes and proves the item", () => {
    makeShown();
    const { question_id, prompt } = drillAnswered(GOOD);
    expect(prompt).toContain("payment provider");
    const out = scoreDrill(db, ctx, {
      question_id,
      hits: [
        { id: "k1", quote: "Set a time limit shorter than the caller's own" },
        { id: "k2", quote: "Retry only with an idempotency key" },
        { id: "k3", quote: "Use backoff with jitter and a cap" },
      ],
      red_flags: [],
    });
    expect(out.passed).toBe(true);
    expect(out.missed_points).toEqual([{ id: "k4", text: keyText("k4") }]);
    expect(status(new Date("2026-11-18T13:00:00Z")).state).toBe("proven");
  });

  it("drops made-up quotes and unknown ids", () => {
    makeShown();
    const { question_id } = drillAnswered(GOOD);
    const out = scoreDrill(db, ctx, {
      question_id,
      hits: [
        { id: "k1", quote: "Set a time limit shorter than the caller's own" },
        { id: "k2", quote: "use a circuit breaker on the provider" },
        { id: "k9", quote: "Use backoff with jitter and a cap" },
      ],
      red_flags: [],
    });
    expect(out.kept_hits).toEqual(["k1"]);
    expect(out.dropped.sort()).toEqual(["k2", "k9"]);
    expect(out.passed).toBe(false);
  });

  it("fails on a red flag even with every key point", () => {
    makeShown();
    const { question_id } = drillAnswered(GOOD + " There is no time limit at all on the retry loop.");
    const out = scoreDrill(db, ctx, {
      question_id,
      hits: [
        { id: "k1", quote: "Set a time limit shorter than the caller's own" },
        { id: "k2", quote: "Retry only with an idempotency key" },
        { id: "k3", quote: "Use backoff with jitter and a cap" },
      ],
      red_flags: [{ id: "r2", quote: "There is no time limit at all" }],
    });
    expect(out.red_flags_hit).toEqual(["r2"]);
    expect(out.passed).toBe(false);
  });

  it("refuses to score an unanswered drill, and scores once", () => {
    makeShown();
    const { question_id } = startDrill(db, ctx, { session_id: "s1" }, NOW);
    expect(() => scoreDrill(db, ctx, { question_id, hits: [], red_flags: [] })).toThrow(/no answer yet/);
    captureAnswer(db, "s1", GOOD, new Date(NOW.getTime() + 60_000));
    scoreDrill(db, ctx, { question_id, hits: [], red_flags: [] });
    expect(() => scoreDrill(db, ctx, { question_id, hits: [], red_flags: [] })).toThrow(/already scored/);
  });

  it("goes back to shown when the developer voids the passed drill", () => {
    makeShown();
    const { question_id } = drillAnswered(GOOD);
    scoreDrill(db, ctx, {
      question_id,
      hits: [
        { id: "k1", quote: "Set a time limit shorter than the caller's own" },
        { id: "k2", quote: "Retry only with an idempotency key" },
      ],
      red_flags: [],
    });
    const attempt = db.prepare("SELECT id FROM drill_attempts").get() as { id: string };
    disagree(db, { target_id: attempt.id, reason: "I looked the answer up first" });
    expect(status(new Date("2026-11-18T13:00:00Z")).state).toBe("shown");
  });

  it("lists drills that are ready", () => {
    expect(drillsReady(db, [{ loaded, statuses: new Map([["BE.ERR.M2", status()]]) }], NOW)).toEqual([]);
    makeShown();
    expect(drillsReady(db, [{ loaded, statuses: new Map([["BE.ERR.M2", status()]]) }], NOW)).toEqual(["BE.ERR.M2"]);
  });
});
