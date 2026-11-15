import { describe, expect, it } from "vitest";
import { DATA_TABLES } from "../src/db/migrations";
import { InvalidReferenceError, NotFoundError, PrivacyRejection } from "../src/errors";
import { count, memoryStore, SpyGuard, TICKET } from "./helpers";

const ASSUMPTION = {
  text: "Which invoices?",
  readings: ["All of them", "Only the filtered ones"],
  status: "answered_by_po" as const,
  answer: "Only the filtered ones",
};

describe("Store", () => {
  it("groups assumptions by /fork run, newest first, in the order given", () => {
    const { store } = memoryStore();
    store.upsertTicket(TICKET);
    const first = store.saveAssumptions(TICKET.id, [ASSUMPTION]);
    const second = store.saveAssumptions(TICKET.id, [
      { ...ASSUMPTION, text: "First" },
      { ...ASSUMPTION, text: "Second", status: "assumed_by_dev" },
    ]);

    const runs = store.listForkRuns(TICKET.id);
    expect(runs.map((run) => run.run_id)).toEqual([second.run_id, first.run_id]);
    expect(runs[0]?.assumptions.map((a) => a.text)).toEqual(["First", "Second"]);
    expect(runs[0]?.assumptions[1]?.status).toBe("assumed_by_dev");
    expect(store.listTickets()).toEqual([
      expect.objectContaining({ id: TICKET.id, fork_runs: 2 }),
    ]);
  });

  it("refuses to save against a ticket it has never seen", () => {
    const { store } = memoryStore();
    expect(() => store.saveAssumptions("T-404", [ASSUMPTION])).toThrow(NotFoundError);
    expect(() =>
      store.logDecision({ ticket_id: "T-404", session_id: "s", summary: "x", alternatives: [], origin: "ai" }),
    ).toThrow(NotFoundError);
  });

  it("stores a pointer to the code, not the code", () => {
    const { store } = memoryStore();
    store.upsertTicket(TICKET);
    const { decision, pointer } = store.logDecision({
      ticket_id: TICKET.id,
      session_id: "sess-1",
      summary: "Stream the file.",
      alternatives: ["Buffer it."],
      origin: "dev_changed_ai",
      pointer: { file_path: "src/export.ts", line_hint: 12, repo: "acme/demo", commit: "abc1234" },
    });
    expect(decision.pointer_id).toBe(pointer?.id);
    expect(pointer).toMatchObject({
      file_path: "src/export.ts",
      line_hint: 12,
      repo: "acme/demo",
      commit: "abc1234",
      symbol: null,
      pr_number: null,
    });
  });

  it("only accepts evidence that exists", () => {
    const { store } = memoryStore();
    store.upsertTicket(TICKET);
    const { decision } = store.logDecision({
      ticket_id: TICKET.id,
      session_id: "s",
      summary: "x",
      alternatives: [],
      origin: "ai",
    });
    const explain = store.recordExplainBack({
      decision_id: decision.id,
      question: "Why?",
      answer: "Because.",
      rating: "partial",
    });

    expect(() =>
      store.saveObservation({ developer_id: "dev", skill_tag: "t", summary: "s", evidence_ids: ["dec_nope"] }),
    ).toThrow(InvalidReferenceError);

    const observation = store.saveObservation({
      developer_id: "dev",
      skill_tag: "t",
      summary: "s",
      evidence_ids: [decision.id, explain.id, decision.id],
    });
    expect(observation.evidence_ids).toEqual([decision.id, explain.id]);
  });

  it("marks single-observation claims tentative and rejects unsupported ones (BE-11 rule)", () => {
    const { store } = memoryStore();
    store.upsertTicket(TICKET);
    const { decision } = store.logDecision({
      ticket_id: TICKET.id,
      session_id: "s",
      summary: "x",
      alternatives: [],
      origin: "dev",
    });
    const obs = (developer: string) =>
      store.saveObservation({ developer_id: developer, skill_tag: "t", summary: "s", evidence_ids: [decision.id] });
    const one = obs("dev");
    const two = obs("dev");
    const someoneElses = obs("other-dev");

    const plan = store.saveGrowthPlan({
      developer_id: "dev",
      focus_areas: [
        { claim: "Backed twice", evidence_ids: [one.id, two.id], exercise: "e" },
        { claim: "Backed once", evidence_ids: [one.id, one.id], exercise: "e" },
      ],
    });
    expect(plan.focus_areas.map((area) => area.tentative)).toEqual([false, true]);

    expect(() =>
      store.saveGrowthPlan({
        developer_id: "dev",
        focus_areas: [{ claim: "No evidence", evidence_ids: [], exercise: "e" }],
      }),
    ).toThrow(InvalidReferenceError);
    expect(() =>
      store.saveGrowthPlan({
        developer_id: "dev",
        focus_areas: [{ claim: "Borrowed evidence", evidence_ids: [someoneElses.id], exercise: "e" }],
      }),
    ).toThrow(InvalidReferenceError);
  });
});

describe("privacy guard seam (ready for BE-9)", () => {
  it("is consulted on every write path, with the text about to be stored", () => {
    const guard = new SpyGuard();
    const { store } = memoryStore(guard);

    store.upsertTicket(TICKET);
    store.saveAssumptions(TICKET.id, [ASSUMPTION]);
    const { decision } = store.logDecision({
      ticket_id: TICKET.id,
      session_id: "s",
      summary: "Decided.",
      alternatives: ["Other."],
      origin: "ai",
      pointer: { file_path: "src/a.ts" },
    });
    const explain = store.recordExplainBack({
      decision_id: decision.id,
      question: "Why?",
      answer: "Because.",
      rating: "clear",
    });
    const observation = store.saveObservation({
      developer_id: "dev",
      skill_tag: "tag",
      summary: "Observed.",
      evidence_ids: [explain.id],
    });
    store.saveGrowthPlan({
      developer_id: "dev",
      focus_areas: [{ claim: "Claim.", evidence_ids: [observation.id], exercise: "Practise." }],
    });

    expect(guard.seen.map((input) => input.kind)).toEqual([
      "ticket",
      "assumption",
      "decision",
      "pointer",
      "explain_back",
      "observation",
      "growth_plan",
    ]);
    expect(guard.seen[1]?.fields).toEqual({
      text: ASSUMPTION.text,
      readings: ASSUMPTION.readings,
      answer: ASSUMPTION.answer,
    });
  });

  it("writes nothing when the guard rejects", () => {
    const guard = new SpyGuard();
    const { db, store } = memoryStore(guard);
    store.upsertTicket(TICKET);
    const { decision } = store.logDecision({
      ticket_id: TICKET.id,
      session_id: "s",
      summary: "ok",
      alternatives: [],
      origin: "ai",
    });
    const observation = store.saveObservation({
      developer_id: "dev",
      skill_tag: "t",
      summary: "s",
      evidence_ids: [decision.id],
    });
    const before = Object.fromEntries(DATA_TABLES.map((table) => [table, count(db, table)]));

    guard.reject = true;
    const writes: Array<() => unknown> = [
      () => store.upsertTicket({ ...TICKET, id: "T-2" }),
      () => store.saveAssumptions(TICKET.id, [ASSUMPTION, ASSUMPTION]),
      () =>
        store.logDecision({
          ticket_id: TICKET.id,
          session_id: "s",
          summary: "blocked",
          alternatives: [],
          origin: "ai",
          pointer: { file_path: "src/a.ts" },
        }),
      () => store.recordExplainBack({ decision_id: decision.id, question: "q", answer: "a", rating: "clear" }),
      () => store.saveObservation({ developer_id: "dev", skill_tag: "t", summary: "s", evidence_ids: [decision.id] }),
      () =>
        store.saveGrowthPlan({
          developer_id: "dev",
          focus_areas: [{ claim: "c", evidence_ids: [observation.id], exercise: "e" }],
        }),
    ];
    for (const write of writes) expect(write).toThrow(PrivacyRejection);

    const after = Object.fromEntries(DATA_TABLES.map((table) => [table, count(db, table)]));
    expect(after).toEqual(before);
  });

  it("explains the rejection", () => {
    const guard = new SpyGuard();
    guard.reject = true;
    const { store } = memoryStore(guard);
    expect(() => store.upsertTicket(TICKET)).toThrow(
      'Rejected by the privacy guard (test-rule, field "title"): blocked by test',
    );
  });
});
