import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { loadLadder } from "./ladder/load.js";
import { captureAnswer, HELD_BACK, isClarification, isLaterReply, openQuestion, proposeQuestions, rateAnswer } from "./questions.js";
import { quoteIn } from "./quote.js";
import { computeStatuses } from "./status.js";

let db: Db;
const NOW = new Date("2026-11-18T12:00:00Z");
const ladder = loadLadder("backend", { repoRoot: "/nowhere", home: "/nowhere" });

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  db.prepare("INSERT INTO tickets (id, title, body, source) VALUES ('PAY-1', 't', 'b', 'test')").run();
});
afterEach(() => db.close());

function devProof(itemId: string, symbol = "charge", signal = "err.timeout-set") {
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, signal_id, file_path, symbol, at) VALUES (?, 'builtin/backend', ?, 'rule', 'positive', 'dev', 'PAY-1', ?, 'src/pay.ts', ?, '2026-11-10T10:00:00Z')",
  ).run(randomUUID(), itemId, signal, symbol);
}
function aiDecision(itemId: string | null): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO decisions (id, ticket_id, session_id, summary, origin, ladder_id, item_id) VALUES (?, 'PAY-1', 's0', 'Retry the charge twice with backoff', 'ai', 'builtin/backend', ?)",
  ).run(id, itemId);
  return id;
}
const propose = (max = 3) => proposeQuestions(db, [{ loaded: ladder, statuses: computeStatuses(db, ladder, NOW) }], max);

describe("proposeQuestions", () => {
  it("asks why about a developer proof on a learning item", () => {
    devProof("BE.ERR.M2");
    const [q] = propose();
    expect(q).toMatchObject({ kind: "why", item_id: "BE.ERR.M2", ticket: "PAY-1", opened: false });
    expect(q!.about).toContain("time limit");
    expect(q!.about).toContain("src/pay.ts");
  });

  it("returns the same pending question the next time, not a new one", () => {
    devProof("BE.ERR.M2");
    const first = propose();
    expect(propose().map((q) => q.question_id)).toEqual(first.map((q) => q.question_id));
  });

  it("asks about AI decisions that have an item and no explain-back", () => {
    aiDecision("BE.ERR.M3");
    aiDecision(null);
    const qs = propose();
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ kind: "explain_back", item_id: "BE.ERR.M3" });
    expect(qs[0]!.about).toContain("Retry the charge");
  });

  it("asks at most max questions, never two on one item", () => {
    devProof("BE.ERR.M2", "a");
    devProof("BE.ERR.M2", "b");
    devProof("BE.ERR.M3", "c", "err.error-cause");
    devProof("BE.ERR.J1", "d", "err.empty-catch");
    aiDecision("BE.ERR.M1");
    const qs = propose(3);
    expect(qs).toHaveLength(3);
    expect(new Set(qs.map((q) => q.item_id)).size).toBe(3);
  });
});

describe("open, capture and rate", () => {
  function opened(session = "s1") {
    devProof("BE.ERR.M2");
    const [q] = propose();
    return openQuestion(db, { session_id: session, question_id: q!.question_id, text: "Why did you pick 5 seconds for the payment call?" }, NOW);
  }
  const later = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);
  const row = (id: string) => db.prepare("SELECT * FROM pending_questions WHERE id = ?").get(id) as Record<string, unknown>;

  it("saves the next message in the same session as the answer, word for word", () => {
    const q = opened();
    expect(captureAnswer(db, "s2", "Because the provider can hang", later(1))).toEqual({ captured: false });
    const out = captureAnswer(db, "s1", "Because the provider can hang for 30s and our caller gives up at 10s", later(1));
    expect(out).toEqual({ captured: true, question_id: q.question_id, closed: "answered" });
    expect(row(q.question_id)).toMatchObject({ answer: "Because the provider can hang for 30s and our caller gives up at 10s", closed_reason: "answered", open_session: null });
  });

  it("keeps a question for later", () => {
    const q = opened();
    expect(captureAnswer(db, "s1", "Later.", later(1))).toEqual({ captured: true, question_id: q.question_id, closed: "later" });
    expect(propose().map((p) => p.question_id)).toContain(q.question_id);
  });

  it("does not take a clarifying question or a slash command as the answer (Review Focus 3)", () => {
    const q = opened();
    expect(captureAnswer(db, "s1", "wait, what do you mean by timeout?", later(1))).toEqual({ captured: false });
    expect(captureAnswer(db, "s1", "/coach", later(1))).toEqual({ captured: false });
    expect(row(q.question_id).open_session).toBe("s1");
  });

  it("closes a question open for more than 30 minutes and does not capture", () => {
    const q = opened();
    expect(captureAnswer(db, "s1", "Because the provider can hang", later(31))).toEqual({ captured: false });
    expect(row(q.question_id)).toMatchObject({ closed_reason: "timeout", answer: null });
  });

  it("holds back an answer the privacy check refuses", () => {
    const q = opened();
    captureAnswer(db, "s1", "const t = AbortSignal.timeout(5000);", later(1), () => false);
    expect(row(q.question_id).answer).toBe(HELD_BACK);
  });

  it("keeps the trade-off flag only when the quote is really in the answer", () => {
    const q = opened();
    captureAnswer(db, "s1", "A short limit frees the worker fast, but a slow success becomes a failure we must retry", later(1));
    expect(rateAnswer(db, { question_id: q.question_id, rating: "clear", tradeoff_quote: "the limit trades speed for safety" })).toMatchObject({
      names_tradeoff: false,
      note: "The quote is not in the answer, so the trade-off flag was dropped.",
    });
  });

  it("sets the trade-off flag for a real quote, and rates only once", () => {
    const q = opened();
    captureAnswer(db, "s1", "A short limit frees the worker fast, but a slow success becomes a failure we must retry", later(1));
    expect(rateAnswer(db, { question_id: q.question_id, rating: "clear", tradeoff_quote: "but a slow success becomes a failure" }).names_tradeoff).toBe(true);
    expect(() => rateAnswer(db, { question_id: q.question_id, rating: "clear" })).toThrow(/already rated/);
  });

  it("refuses to rate a question with no answer", () => {
    const q = opened();
    expect(() => rateAnswer(db, { question_id: q.question_id, rating: "clear" })).toThrow(/no answer yet/);
  });

  it("opens an explain-back from a decision and saves the explain-back row when rated", () => {
    const decisionId = aiDecision("BE.ERR.M3");
    const q = openQuestion(db, { session_id: "s1", decision_id: decisionId, ladder_id: "builtin/backend", text: "Why retry only twice?" }, NOW);
    expect(q.kind).toBe("explain_back");
    captureAnswer(db, "s1", "Two tries cover a blip; more would hold the user too long", later(1));
    rateAnswer(db, { question_id: q.question_id, rating: "partial" });
    expect(db.prepare("SELECT rating, item_id, question_id FROM explain_backs WHERE decision_id = ?").get(decisionId)).toEqual({
      rating: "partial",
      item_id: "BE.ERR.M3",
      question_id: q.question_id,
    });
  });

  it("opening a new question puts the old open one aside for later", () => {
    devProof("BE.ERR.M2", "a");
    devProof("BE.ERR.M3", "b", "err.error-cause");
    const [a, b] = propose();
    openQuestion(db, { session_id: "s1", question_id: a!.question_id, text: "First?" }, NOW);
    openQuestion(db, { session_id: "s1", question_id: b!.question_id, text: "Second?" }, NOW);
    expect(row(a!.question_id)).toMatchObject({ closed_reason: "later", open_session: null });
  });
});

describe("reply helpers", () => {
  it("knows a 'later' reply", () => {
    for (const t of ["later", "Later.", "skip", "SKIP!", "not now", "later please"]) expect(isLaterReply(t), t).toBe(true);
    expect(isLaterReply("later I will explain why")).toBe(false);
  });
  it("knows a short clarifying question", () => {
    expect(isClarification("what do you mean?")).toBe(true);
    expect(isClarification("Because it can hang. Why do you ask?".padEnd(130, " x") + "?")).toBe(false);
  });
  it("matches quotes loosely on case and spaces, and needs 12 characters", () => {
    expect(quoteIn("A slow   success becomes a Failure", "slow success becomes a failure")).toBe(true);
    expect(quoteIn("A slow success", "slow")).toBe(false);
  });
});
