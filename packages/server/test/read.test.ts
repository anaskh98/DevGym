import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CoachReportResponse,
  EvalResults,
  focusTargetId,
  ForkResultResponse,
  MyDataResponse,
  PaperTrailResponse,
  STORED_KINDS,
  TicketListResponse,
} from "@ftc/shared";
import { describe, expect, it } from "vitest";
import { exportMock, readEvalResults } from "../src/cli/export-mock";
import { InvalidReferenceError } from "../src/errors";
import { DATA_TABLES } from "../src/db/migrations";
import { count, memoryStore, TICKET } from "./helpers";

function seeded() {
  const memory = memoryStore();
  const { store } = memory;
  store.upsertTicket(TICKET);
  store.saveAssumptions(TICKET.id, [
    { text: "Q?", readings: ["a", "b"], status: "assumed_by_dev", answer: "a" },
  ]);
  const first = store.logDecision({
    ticket_id: TICKET.id,
    session_id: "s1",
    summary: "First decision.",
    alternatives: ["Other."],
    origin: "ai",
    pointer: { file_path: "src/a.ts", line_hint: 3, repo: "acme/demo", commit: "abc1234" },
  });
  const second = store.logDecision({
    ticket_id: TICKET.id,
    session_id: "s1",
    summary: "Second decision.",
    alternatives: [],
    origin: "dev",
  });
  const explain = store.recordExplainBack({
    decision_id: first.decision.id,
    question: "Why?",
    answer: "Because.",
    rating: "partial",
  });
  const observation = store.saveObservation({
    developer_id: "dev",
    skill_tag: "tag",
    summary: "Seen.",
    evidence_ids: [explain.id],
  });
  const plan = store.saveGrowthPlan({
    developer_id: "dev",
    focus_areas: [{ claim: "Claim.", evidence_ids: [observation.id], exercise: "Do it." }],
  });
  return { ...memory, first, second, explain, observation, plan };
}

describe("reading for the web app", () => {
  it("lists a ticket's decisions in order, each with its pointer and explain-backs", () => {
    const { store, first, second, explain } = seeded();
    const views = store.listDecisionViews(TICKET.id);

    expect(views.map((view) => view.id)).toEqual([first.decision.id, second.decision.id]);
    expect(views[0]?.pointer).toMatchObject({ file_path: "src/a.ts", repo: "acme/demo", commit: "abc1234" });
    expect(views[0]?.explain_backs).toEqual([explain]);
    expect(views[1]?.pointer).toBeNull();
    expect(views[1]?.explain_backs).toEqual([]);
    expect(store.listDecisionViews("T-404")).toEqual([]);
  });

  it("counts fork runs and decisions per ticket", () => {
    const { store } = seeded();
    expect(store.listTickets()).toEqual([
      expect.objectContaining({ id: TICKET.id, fork_runs: 1, decisions: 2 }),
    ]);
  });

  it("reads every record of every kind", () => {
    const { db, store } = seeded();
    const all = store.readAll();
    expect(Object.keys(all).sort()).toEqual([...DATA_TABLES].sort());
    expect([...STORED_KINDS].sort()).toEqual([...DATA_TABLES].sort());
    for (const table of DATA_TABLES) {
      expect(all[table], table).toHaveLength(count(db, table));
    }
    expect(all.growth_plans[0]?.focus_areas[0]?.tentative).toBe(true);
  });

  it("exports files that match the shapes the web app validates against", async () => {
    const { store } = seeded();
    const out = await mkdtemp(join(tmpdir(), "ftc-export-"));
    await exportMock(store, out, { storedIn: "/tmp/x.sqlite", developerId: "dev" });
    const read = async (path: string) => JSON.parse(await readFile(join(out, path), "utf8")) as unknown;

    expect(TicketListResponse.parse(await read("api/tickets.json")).tickets).toHaveLength(1);
    expect(ForkResultResponse.parse(await read(`api/tickets/${TICKET.id}/fork.json`)).runs).toHaveLength(1);
    expect(PaperTrailResponse.parse(await read(`api/tickets/${TICKET.id}/trail.json`)).decisions).toHaveLength(2);
    const data = MyDataResponse.parse(await read("api/data.json"));
    expect(data.stored_in).toBe("/tmp/x.sqlite");
    expect(data.data.decisions).toHaveLength(2);
    expect(CoachReportResponse.parse(await read("api/coach.json")).plan?.focus_areas).toHaveLength(1);
    // No evaluation has been run, so there is no eval file to serve.
    await expect(read("api/eval.json")).rejects.toThrow();
  });

  it("includes the eval results when there are some", async () => {
    const { store } = seeded();
    const out = await mkdtemp(join(tmpdir(), "ftc-export-"));
    const sample = EvalResults.parse(
      JSON.parse(await readFile(join(import.meta.dirname, "../fixtures/sample-eval.json"), "utf8")),
    );
    await exportMock(store, out, { storedIn: "x", developerId: "dev", evalResults: sample });
    expect(JSON.parse(await readFile(join(out, "api/eval.json"), "utf8"))).toEqual(sample);
    expect(sample.scores.map((score) => score.id)).toEqual(["fork", "paper_trail", "pointers", "coach", "privacy"]);
    expect(await readEvalResults(join(out, "missing.json"))).toBeUndefined();
  });
});

describe("coach report and notes (for FE-5)", () => {
  it("links each claim to its observations, and those to decisions", () => {
    const { store, first, explain, observation, plan } = seeded();
    const report = store.getCoachReport("dev");

    expect(report.plan?.id).toBe(plan.id);
    const area = report.plan?.focus_areas[0];
    expect(area).toMatchObject({ claim: "Claim.", tentative: true, target_id: focusTargetId(plan.id, 0) });
    expect(area?.observations.map((o) => o.id)).toEqual([observation.id]);
    expect(area?.observations[0]?.evidence).toEqual([
      { id: explain.id, kind: "explain_back", ticket_id: TICKET.id, decision_id: first.decision.id, label: "Why?" },
    ]);
  });

  it("returns no plan for a developer who has none", () => {
    const { store } = seeded();
    expect(store.getCoachReport("someone-else")).toEqual({ developer_id: "someone-else", plan: null });
  });

  it("returns the newest plan", () => {
    const { store, observation } = seeded();
    const newer = store.saveGrowthPlan({
      developer_id: "dev",
      focus_areas: [{ claim: "Newer claim.", evidence_ids: [observation.id], exercise: "e" }],
    });
    expect(store.getCoachReport("dev").plan?.id).toBe(newer.id);
  });

  it("saves a note on a claim and shows it with the claim", () => {
    const { store, plan } = seeded();
    const target = focusTargetId(plan.id, 0);
    const note = store.addAnnotation({ target_id: target, note: "I disagree: I did check.", disagrees: true });

    expect(note).toMatchObject({ target_id: target, disagrees: true });
    expect(store.getCoachReport("dev").plan?.focus_areas[0]?.annotations).toEqual([note]);
    expect(store.readAll().annotations).toEqual([note]);
  });

  it("refuses a note on something that is not a saved focus area", () => {
    const { store, plan } = seeded();
    for (const target of [`${plan.id}/focus/2`, `${plan.id}/focus/0`, "plan_missing/focus/1", "dec_123", ""]) {
      expect(() => store.addAnnotation({ target_id: target, note: "n", disagrees: false }), target).toThrow(
        InvalidReferenceError,
      );
    }
    expect(store.readAll().annotations).toEqual([]);
  });
});
