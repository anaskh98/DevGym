import { describe, expect, it } from "vitest";
import { BUILTIN_LADDERS } from "./ladder/builtin.js";
import { findItem } from "./ladder/load.js";
import { DEFAULT_THRESHOLDS as T, type LadderItem } from "./ladder/schema.js";
import type { Exposure } from "./exposure.js";
import { areaLevel, itemStatus, type AnswerFact, type DrillFact, type EvidenceFact, type ItemStatus } from "./state.js";

const NOW = new Date("2026-11-18T12:00:00Z");
const M2 = findItem(BUILTIN_LADDERS.backend, "BE.ERR.M2")!.item;
const NO_SIGNALS: LadderItem = { ...M2, id: "BE.ERR.S1", signals: [] };

let n = 0;
/** A positive proof from the developer, each in its own function so each is a separate proof. */
const dev = (o: Partial<EvidenceFact> = {}): EvidenceFact => ({
  id: `e${++n}`,
  kind: "rule",
  polarity: "positive",
  author: "dev",
  decided_by: null,
  history: false,
  regresses: false,
  signal_id: "err.timeout-set",
  file: "src/pay.ts",
  symbol: `f${n}`,
  ticket: "T-1",
  at: "2026-11-10T10:00:00Z",
  fixed_at: null,
  fixed_ticket: null,
  disagreed: false,
  ...o,
});
const ai = (o: Partial<EvidenceFact> = {}) => dev({ author: "ai", ...o });
const fault = (o: Partial<EvidenceFact> = {}) => dev({ polarity: "negative", signal_id: "err.empty-catch", ...o });
const answer = (rating: AnswerFact["rating"], o: Partial<AnswerFact> = {}): AnswerFact => ({
  id: `a${++n}`,
  rating,
  ticket: "T-1",
  names_tradeoff: false,
  at: "2026-11-12T10:00:00Z",
  ...o,
});
const drill = (passed: boolean, o: Partial<DrillFact> = {}): DrillFact => ({ id: `d${++n}`, drill_id: "d1", passed, void: false, at: "2026-11-15T10:00:00Z", ...o });

/** Enough for Shown: 3 proofs on 2 tickets, 2 clear answers on 2 tickets, one naming the trade-off. */
const proofs3 = () => [dev({ ticket: "T-1" }), dev({ ticket: "T-1" }), dev({ ticket: "T-2" })];
const clear2 = () => [answer("clear", { ticket: "T-1", names_tradeoff: true }), answer("clear", { ticket: "T-2" })];

function status(
  evidence: EvidenceFact[] = [],
  answers: AnswerFact[] = [],
  drills: DrillFact[] = [],
  item = M2,
  now = NOW,
  exposure: Exposure = { level: "none", functions: 0 },
): ItemStatus {
  return itemStatus({ item, evidence, answers, drills, exposure }, now, T);
}

describe("itemStatus", () => {
  it("is not_seen with no facts", () => {
    expect(status().state).toBe("not_seen");
  });

  it("is not assessed with one developer proof and no gap", () => {
    const s = status([dev()]);
    expect(s.state).toBe("not_assessed");
    expect(s.proofs).toBe(1);
    expect(s.needs).toContain("2 more code proofs");
  });

  it("ignores AI-written positives unless the developer decided", () => {
    expect(status([ai(), ai(), ai()]).proofs).toBe(0);
    expect(status([ai(), ai(), ai()]).state).toBe("not_seen");
    expect(status([ai({ decided_by: "dev" })]).proofs).toBe(1);
  });

  it("needs both code and explained to be shown", () => {
    expect(status(proofs3()).state).toBe("not_assessed");
    expect(status([], clear2()).state).toBe("not_assessed");
    expect(status(proofs3(), clear2()).state).toBe("shown");
  });

  it("needs an answer that names the trade-off", () => {
    const s = status(proofs3(), [answer("clear", { ticket: "T-1" }), answer("clear", { ticket: "T-2" })]);
    expect(s.state).toBe("not_assessed");
    expect(s.needs).toContain("an answer that names the trade-off");
  });

  it("needs clear answers on two different tickets", () => {
    const s = status(proofs3(), [answer("clear", { names_tradeoff: true }), answer("clear")]);
    expect(s.state).toBe("not_assessed");
    expect(s.needs).toContain("1 more clear answer");
  });

  it("needs proofs on two distinct tickets", () => {
    const s = status([dev(), dev(), dev()], clear2());
    expect(s.state).toBe("not_assessed");
    expect(s.needs).toContain("proof on 1 more ticket");
  });

  it("counts hits in the same function once", () => {
    const same = { signal_id: "err.timeout-set", file: "src/pay.ts", symbol: "charge" };
    expect(status([dev(same), dev({ ...same, ticket: "T-2" }), dev(same)]).proofs).toBe(1);
  });

  it("drops proofs older than 60 days", () => {
    const old = [dev({ at: "2026-08-01T10:00:00Z" }), dev({ at: "2026-08-01T10:00:00Z", ticket: "T-2" }), dev({ at: "2026-08-02T10:00:00Z" })];
    expect(status(old, clear2()).proofs).toBe(0);
  });

  it("blocks shown while a fault is unfixed", () => {
    const s = status([...proofs3(), fault({ ticket: "T-3", file: "src/refund.ts" })], clear2());
    expect(s.state).toBe("learning");
    expect(s.open_faults).toBe(1);
    expect(s.needs).toContain("fix the open fault in refund.ts");
  });

  it("does not count a fault fixed in the same ticket", () => {
    const fixed = fault({ ticket: "T-3", fixed_ticket: "T-3", fixed_at: "2026-11-11T10:00:00Z" });
    expect(status([fixed]).state).toBe("not_seen");
    expect(status([...proofs3(), fixed], clear2()).state).toBe("shown");
  });

  it("lets a fault fixed on a later ticket stop blocking shown", () => {
    const fixedLater = fault({ ticket: "T-3", fixed_ticket: "T-4", fixed_at: "2026-11-11T10:00:00Z" });
    expect(status([...proofs3(), fixedLater], clear2()).state).toBe("shown");
  });

  it("caps judge proofs at 1 when the item has signals", () => {
    const judged = [dev({ kind: "judge" }), dev({ kind: "judge", ticket: "T-2" }), dev({ kind: "judge" })];
    expect(status(judged).proofs).toBe(1);
    expect(status(judged, [], [], NO_SIGNALS).proofs).toBe(3);
  });

  it("caps proofs from past commits at 1", () => {
    expect(status([dev({ history: true }), dev({ history: true, ticket: "T-2" })]).proofs).toBe(1);
  });

  it("becomes proven only with a drill passed while shown", () => {
    const early = drill(true, { at: "2026-11-09T10:00:00Z" }); // before the proofs and answers
    expect(status(proofs3(), clear2(), [early]).state).toBe("shown");
    const s = status(proofs3(), clear2(), [drill(true)]);
    expect(s.state).toBe("proven");
    expect(s.proven_at).toBe("2026-11-15T10:00:00Z");
  });

  it("stays shown after a failed drill, and needs a drill", () => {
    const s = status(proofs3(), clear2(), [drill(false)]);
    expect(s.state).toBe("shown");
    expect(s.needs).toEqual(["pass a drill"]);
  });

  it("stays proven after the window passes", () => {
    expect(status(proofs3(), clear2(), [drill(true)], M2, new Date("2027-06-01T00:00:00Z")).state).toBe("proven");
  });

  it("ignores a void drill", () => {
    expect(status(proofs3(), clear2(), [drill(true, { void: true })]).state).toBe("shown");
  });

  it("drops to learning after a regressing fault and needs fresh proofs", () => {
    const drop = fault({ regresses: true, ticket: "T-3", at: "2026-11-16T10:00:00Z", fixed_ticket: "T-4", fixed_at: "2026-11-17T09:00:00Z" });
    const s = status([...proofs3(), drop], clear2(), [drill(true)]);
    expect(s.state).toBe("learning");
    expect(s.regressed_at).toBe("2026-11-16T10:00:00Z");
    expect(s.proofs).toBe(0); // the old proofs came before the drop
    const fresh = [dev({ ticket: "T-5", at: "2026-11-17T10:00:00Z" }), dev({ ticket: "T-5", at: "2026-11-17T10:00:00Z" }), dev({ ticket: "T-6", at: "2026-11-17T11:00:00Z" })];
    const answers = [answer("clear", { ticket: "T-5", names_tradeoff: true, at: "2026-11-17T12:00:00Z" }), answer("clear", { ticket: "T-6", at: "2026-11-17T12:00:00Z" })];
    expect(status([...proofs3(), drop, ...fresh], [...clear2(), ...answers], [drill(true)]).state).toBe("shown");
  });

  it("drops to learning after a not_yet answer", () => {
    const s = status(proofs3(), [...clear2(), answer("not_yet", { at: "2026-11-13T10:00:00Z" })]);
    expect(s.state).toBe("learning");
    expect(s.regressed_at).toBe("2026-11-13T10:00:00Z");
  });

  it("ignores disagreed credit, but not disagreed faults", () => {
    expect(status([dev({ disagreed: true })]).state).toBe("not_seen");
    // A fault still counts after a disagree: disagreeing can only lower a state.
    expect(status([...proofs3(), fault({ disagreed: true })], clear2()).state).toBe("learning");
  });

  it("compares dates, not text, across time zones", () => {
    // 09:00 at +02:00 is 07:00 UTC, before a fault at 08:00 UTC: the proof came before the drop.
    const drop = fault({ regresses: true, at: "2026-11-10T08:00:00Z", fixed_ticket: "T-9", fixed_at: "2026-11-10T09:00:00Z", ticket: "T-8" });
    expect(status([dev({ at: "2026-11-10T09:00:00+02:00" }), drop]).proofs).toBe(0);
  });
});

describe("areaLevel", () => {
  const area = BUILTIN_LADDERS.backend.areas.find((a) => a.id === "ERR")!;
  const make = (states: Record<string, ItemStatus["state"]>) =>
    new Map(Object.entries(states).map(([id, state]) => [id, { item_id: id, state } as ItemStatus]));

  it("gives the area level from proven items", () => {
    const s = make({ "BE.ERR.J1": "proven", "BE.ERR.J2": "proven", "BE.ERR.M1": "proven", "BE.ERR.M2": "shown" });
    expect(areaLevel(area, s)).toEqual({ level: "junior", working_toward: "mid" });
  });

  it("has no level until every junior item is proven", () => {
    expect(areaLevel(area, make({ "BE.ERR.J1": "proven" }))).toEqual({ level: null, working_toward: "junior" });
  });

  it("reaches the top with nothing left to work toward", () => {
    const all = Object.fromEntries(["J1", "J2", "M1", "M2", "M3", "S1", "S2", "X1"].map((k) => [`BE.ERR.${k}`, "proven" as const]));
    expect(areaLevel(area, make(all))).toEqual({ level: "staff", working_toward: null });
  });
});

describe("review fixes", () => {
  const ONLY_NEGATIVE: LadderItem = { ...M2, id: "BE.ERR.J1", signals: [{ id: "err.empty-catch", polarity: "negative", regresses: true }] };

  it("does not cap judge proofs for an item with only negative signals", () => {
    const judged = [dev({ kind: "judge", signal_id: null }), dev({ kind: "judge", signal_id: null, ticket: "T-2" }), dev({ kind: "judge", signal_id: null })];
    expect(status(judged, [], [], ONLY_NEGATIVE).proofs).toBe(3);
  });

  it("counts judge proofs on the same function once", () => {
    const same = { kind: "judge" as const, signal_id: null, file: "src/pay.ts", symbol: "charge" };
    expect(status([dev(same), dev({ ...same, ticket: "T-2" }), dev(same)], [], [], NO_SIGNALS).proofs).toBe(1);
  });

  it("keeps counting a fault the developer disagreed with, so disagreeing never raises a state", () => {
    const drop = fault({ regresses: true, ticket: "T-3", at: "2026-11-16T10:00:00Z", disagreed: true });
    const s = status([...proofs3(), drop], clear2(), [drill(true)]);
    expect(s.state).toBe("learning");
    expect(s.regressed_at).toBe("2026-11-16T10:00:00Z");
  });
});

describe("stage 1.5: not assessed, gaps, no decay", () => {
  it("shows not assessed, never learning, for good proofs with no gap (Review Focus 1)", () => {
    expect(status([dev(), dev({ ticket: "T-2" })]).state).toBe("not_assessed");
  });

  it("is learning when the latest answer is partial", () => {
    expect(status([dev()], [answer("partial")]).state).toBe("learning");
  });

  it("is learning when the latest drill failed with no pass after it", () => {
    expect(status([dev()], [], [drill(false)]).state).toBe("learning");
  });

  it("is not assessed when the only fault was fixed on a later ticket", () => {
    expect(status([fault({ ticket: "T-3", fixed_ticket: "T-4", fixed_at: "2026-11-11T10:00:00Z" })]).state).toBe("not_assessed");
  });

  it("is not assessed with exposure alone", () => {
    expect(status([], [], [], M2, NOW, { level: "low", functions: 1 }).state).toBe("not_assessed");
    expect(status([], [], [], M2, NOW, { level: "none", functions: 0 }).state).toBe("not_seen");
  });

  it("stays shown a year later with no new activity (Review Focus 2)", () => {
    const s = status(proofs3(), clear2(), [], M2, new Date("2027-11-18T12:00:00Z"));
    expect(s.state).toBe("shown");
    expect(s.shown_by).toBe("work");
    expect(s.shown_at).not.toBeNull();
  });

  it("still drops a shown item after a serious fault", () => {
    const drop = fault({ regresses: true, ticket: "T-3", at: "2026-11-16T10:00:00Z" });
    expect(status([...proofs3(), drop], clear2(), [], M2, new Date("2027-11-18T12:00:00Z")).state).toBe("learning");
  });

  it("says to take a drill when exposure is low", () => {
    expect(status([dev()], [], [], M2, NOW, { level: "low", functions: 1 }).needs).toContain("more chances in your work, or take a drill");
  });

  it("reports the exposure", () => {
    const s = status([dev()], [], [], M2, NOW, { level: "medium", functions: 4 });
    expect(s.exposure).toBe("medium");
    expect(s.exposure_functions).toBe(4);
  });
});

describe("stage 1.5: the drill-only path", () => {
  const low: Exposure = { level: "low", functions: 1 };
  const d = (drill_id: string, at: string, passed = true) => drill(passed, { drill_id, at });

  it("is shown by drill with 2 passed drills on different prompts and 1 clear answer", () => {
    const s = status([], [answer("clear", { at: "2026-11-16T10:00:00Z" })], [d("d1", "2026-11-14T10:00:00Z"), d("d2", "2026-11-15T10:00:00Z")], M2, NOW, low);
    expect(s.state).toBe("shown");
    expect(s.shown_by).toBe("drill");
  });

  it("is not shown with one drill, or the same prompt twice, or no clear answer", () => {
    const clear = [answer("clear", { at: "2026-11-16T10:00:00Z" })];
    expect(status([], clear, [d("d1", "2026-11-14T10:00:00Z")], M2, NOW, low).state).not.toBe("shown");
    expect(status([], clear, [d("d1", "2026-11-14T10:00:00Z"), d("d1", "2026-11-15T10:00:00Z")], M2, NOW, low).state).not.toBe("shown");
    expect(status([], [], [d("d1", "2026-11-14T10:00:00Z"), d("d2", "2026-11-15T10:00:00Z")], M2, NOW, low).state).not.toBe("shown");
  });

  it("never reaches proven from drills alone (Review Focus 3)", () => {
    const drills = [d("d1", "2026-11-14T10:00:00Z"), d("d2", "2026-11-15T10:00:00Z"), d("d3", "2026-11-17T10:00:00Z"), d("d1", "2026-11-18T09:00:00Z")];
    expect(status([], [answer("clear", { at: "2026-11-16T10:00:00Z" })], drills, M2, NOW, low).state).toBe("shown");
  });
});

describe("stage 1.5: needs on the drill-only path", () => {
  it("says how many drills and answers are still needed when the work gives little chance", () => {
    const low: Exposure = { level: "low", functions: 1 };
    const one = status([dev()], [], [drill(true, { drill_id: "d1", at: "2026-11-14T10:00:00Z" })], M2, NOW, low);
    expect(one.needs).toContain("or by drills: pass 1 more drill on a new prompt");
    expect(one.needs).toContain("or by drills: 1 clear answer to a follow-up question");
    const two = status([dev()], [], [drill(true, { drill_id: "d1", at: "2026-11-14T10:00:00Z" }), drill(true, { drill_id: "d2", at: "2026-11-15T10:00:00Z" })], M2, NOW, low);
    expect(two.needs).not.toContain("or by drills: pass 1 more drill on a new prompt");
  });
});

describe("stage 1.5 review fixes", () => {
  const low: Exposure = { level: "low", functions: 1 };
  const d = (drill_id: string, at: string, passed = true, isVoid = false) => drill(passed, { drill_id, at, void: isVoid });

  it("stays shown long after a fault was fixed by a commit with no new proof (C1)", () => {
    const fixedLater = fault({ ticket: "T-3", at: "2026-11-09T10:00:00Z", fixed_ticket: "T-4", fixed_at: "2026-11-14T10:00:00Z" });
    expect(status([...proofs3(), fixedLater], clear2(), [], M2, new Date("2027-03-01T12:00:00Z")).state).toBe("shown");
  });

  it("does not reach shown by drill while a fault is open (I1)", () => {
    const open = fault({ ticket: "T-3", at: "2026-11-13T10:00:00Z" });
    const s = status([open], [answer("clear", { at: "2026-11-16T10:00:00Z" })], [d("d1", "2026-11-14T10:00:00Z"), d("d2", "2026-11-15T10:00:00Z")], M2, NOW, low);
    expect(s.state).toBe("learning");
  });

  it("keeps a voided failed drill as a gap until the next try (I2)", () => {
    expect(status([dev()], [], [d("d1", "2026-11-14T10:00:00Z", false, true)]).state).toBe("learning");
    expect(status([dev()], [], [d("d1", "2026-11-14T10:00:00Z", false, true), d("d2", "2026-11-15T10:00:00Z", true)]).state).toBe("not_assessed");
  });

  it("explains every learning state: an old unfixed fault outside the window is not a hidden gap (I3)", () => {
    const old = fault({ ticket: "T-3", at: "2026-03-01T10:00:00Z" });
    const s = status([dev(), old]);
    if (s.state === "learning") expect(s.needs.some((n) => n.startsWith("fix the open fault"))).toBe(true);
    else expect(s.state).toBe("not_assessed");
  });

  it("puts the real gap before the exposure hint (M2)", () => {
    const s = status([fault({ ticket: "T-3" })], [], [], M2, NOW, low);
    expect(s.needs[0]).toMatch(/fix the open fault|code proof/);
  });
});

describe("stage 2: decision evidence", () => {
  it("counts a developer decision on AI lines under the judge cap, and an AI decision never", () => {
    const decided = (o: Partial<EvidenceFact> = {}) => dev({ kind: "decision", signal_id: null, author: "unknown", decided_by: "dev", ...o });
    expect(status([decided({ symbol: "a" }), decided({ symbol: "b", ticket: "T-2" }), decided({ symbol: "c" })]).proofs).toBe(1);
    expect(status([decided({ decided_by: "ai" })]).proofs).toBe(0);
  });
});
