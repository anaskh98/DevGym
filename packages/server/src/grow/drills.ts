// Drills: interview-style questions on a new situation, scored against the ladder's fixed key.
// The AI lists which key points the answer hits and quotes the words; plain code keeps only real quotes and
// decides pass or fail. A Shown item becomes Proven only through a passed drill.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { exposureFor } from "./exposure.js";
import { factsForItem } from "./facts.js";
import type { LoadedLadder } from "./ladder/load.js";
import { passCount, type Drill, type LadderItem, type Thresholds } from "./ladder/schema.js";
import { quoteIn } from "./quote.js";
import { itemStatus, type DrillFact, type ItemStatus } from "./state.js";
import type { LadderStatuses } from "./status.js";

const DAY = 86_400_000;
const DRILL_REF = "drill:";

export interface DrillContext {
  loaded: LoadedLadder;
  item: LadderItem;
}

/** May the developer take a drill now? Only when Shown, and after a fail: one new proof or a few days. */
export function drillGate(
  status: ItemStatus,
  attempts: DrillFact[],
  newProofsSinceLastFail: number,
  now: Date,
  t: Thresholds,
): { allowed: true } | { allowed: false; reason: string } {
  // A drill opens when the item is Shown, or when the work gives little chance to show it (so it can be assessed apart).
  const lowExposure = status.exposure === "none" || status.exposure === "low";
  if (status.state === "proven") return { allowed: false, reason: "This item is already Proven." };
  if (status.state === "shown" && status.shown_by === "drill") {
    return { allowed: false, reason: "This item is Shown by drills. Show it in your work first; a drill after that can make it Proven." };
  }
  if (status.state !== "shown" && !lowExposure) {
    return {
      allowed: false,
      reason: `A drill opens when the item is Shown, or when your work gives little chance to show it. It is ${status.state.replace("_", " ")} now, and your work touches it often.`,
    };
  }
  const last = attempts.filter((a) => !a.void).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (last && !last.passed) {
    const waited = now.getTime() - Date.parse(last.at) >= t.drill_retry_days * DAY;
    if (!waited && newProofsSinceLastFail < 1) {
      return { allowed: false, reason: `After a failed drill, try again after one new code proof or ${t.drill_retry_days} days.` };
    }
  }
  return { allowed: true };
}

/** The first drill never tried (a void try counts as tried); when all were tried, the one tried longest ago. */
export function pickDrill(item: LadderItem, attempts: DrillFact[]): Drill {
  const lastTried = new Map<string, number>();
  for (const a of attempts) lastTried.set(a.drill_id, Math.max(lastTried.get(a.drill_id) ?? 0, Date.parse(a.at)));
  const fresh = item.drills.find((d) => !lastTried.has(d.id));
  if (fresh) return fresh;
  return [...item.drills].sort((a, b) => (lastTried.get(a.id) ?? 0) - (lastTried.get(b.id) ?? 0))[0]!;
}

function gateFor(db: Db, ctx: DrillContext, now: Date) {
  const facts = factsForItem(db, ctx.loaded.ladder_id, ctx.item.id);
  const exposure = exposureFor(db, ctx.loaded.ladder_id, ctx.item.id, now, ctx.loaded.thresholds);
  const status = itemStatus({ item: ctx.item, ...facts, exposure }, now, ctx.loaded.thresholds);
  const lastFail = facts.drills.filter((d) => !d.void && !d.passed).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const newProofs = lastFail
    ? facts.evidence.filter((e) => e.polarity === "positive" && !e.disagreed && (e.author === "dev" || e.decided_by === "dev") && Date.parse(e.at) > Date.parse(lastFail.at)).length
    : 0;
  return { facts, gate: drillGate(status, facts.drills, newProofs, now, ctx.loaded.thresholds) };
}

/** Starts a drill: checks the gate, picks a prompt, and opens it as this session's question. */
export function startDrill(db: Db, ctx: DrillContext, input: { session_id: string }, now: Date = new Date()): { question_id: string; drill_id: string; prompt: string } {
  const { facts, gate } = gateFor(db, ctx, now);
  if (!gate.allowed) throw new StoreError(gate.reason);
  const drill = pickDrill(ctx.item, facts.drills);
  const id = randomUUID();
  db.prepare("UPDATE pending_questions SET closed_reason = 'later', open_session = NULL WHERE open_session = ? AND answered_at IS NULL").run(input.session_id);
  db.prepare(
    "INSERT INTO pending_questions (id, kind, ladder_id, item_id, target_ref, ticket, question, opened_at, open_session) VALUES (?, 'drill', ?, ?, ?, 'drill', ?, ?, ?)",
  ).run(id, ctx.loaded.ladder_id, ctx.item.id, `${DRILL_REF}${drill.id}`, drill.prompt, now.toISOString(), input.session_id);
  return { question_id: id, drill_id: drill.id, prompt: drill.prompt };
}

/**
 * The drill's fixed key, for scoring. Given only after the developer's answer is saved, so the key can never
 * leak into the question as a hint.
 */
export function drillKey(
  db: Db,
  ctx: DrillContext,
  questionId: string,
): { drill_id: string; key_points: { id: string; text: string }[]; red_flags: { id: string; text: string }[]; pass: number } {
  const row = db.prepare("SELECT kind, item_id, target_ref, answered_at FROM pending_questions WHERE id = ?").get(questionId) as
    | { kind: string; item_id: string; target_ref: string | null; answered_at: string | null }
    | undefined;
  if (!row || row.kind !== "drill" || row.item_id !== ctx.item.id) throw new StoreError(`Question '${questionId}' is not a drill for ${ctx.item.id}`);
  if (row.answered_at === null) throw new StoreError("The key is shown only after the developer answers the drill");
  const drill = ctx.item.drills.find((d) => `${DRILL_REF}${d.id}` === row.target_ref);
  if (!drill) throw new StoreError("The drill this question came from is no longer in the ladder");
  return { drill_id: drill.id, key_points: drill.key_points, red_flags: drill.red_flags, pass: passCount(drill) };
}

export interface ScoreDrillInput {
  question_id: string;
  hits: { id: string; quote: string }[];
  red_flags: { id: string; quote: string }[];
}

/** Scores an answered drill against the key. Quotes not in the answer, and ids not in the drill, are dropped. */
export function scoreDrill(
  db: Db,
  ctx: DrillContext,
  input: ScoreDrillInput,
): { passed: boolean; kept_hits: string[]; dropped: string[]; missed_points: { id: string; text: string }[]; red_flags_hit: string[]; study: string[] } {
  const row = db.prepare("SELECT kind, item_id, target_ref, answer, answered_at FROM pending_questions WHERE id = ?").get(input.question_id) as
    | { kind: string; item_id: string; target_ref: string | null; answer: string | null; answered_at: string | null }
    | undefined;
  if (!row || row.kind !== "drill" || row.item_id !== ctx.item.id) throw new StoreError(`Question '${input.question_id}' is not a drill for ${ctx.item.id}`);
  if (row.answer === null || row.answered_at === null) throw new StoreError("This drill has no answer yet. Ask it and wait for the developer's reply");
  if (db.prepare("SELECT 1 FROM drill_attempts WHERE question_id = ?").get(input.question_id)) throw new StoreError("This drill was already scored");
  const drill = ctx.item.drills.find((d) => `${DRILL_REF}${d.id}` === row.target_ref);
  if (!drill) throw new StoreError("The drill this question came from is no longer in the ladder");

  const keyIds = new Set(drill.key_points.map((k) => k.id));
  const flagIds = new Set(drill.red_flags.map((f) => f.id));
  const dropped: string[] = [];
  const keep = (list: { id: string; quote: string }[], ids: Set<string>) => {
    const kept = new Set<string>();
    for (const h of list) {
      if (ids.has(h.id) && quoteIn(row.answer!, h.quote)) kept.add(h.id);
      else dropped.push(h.id);
    }
    return [...kept];
  };
  const keptHits = keep(input.hits, keyIds);
  const flagsHit = keep(input.red_flags, flagIds);
  const passed = keptHits.length >= passCount(drill) && flagsHit.length === 0;
  // The drill counts at the moment it was answered: that is when the item had to be Shown.
  db.prepare("INSERT INTO drill_attempts (id, ladder_id, item_id, drill_id, question_id, hits, red_flags, passed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    randomUUID(),
    ctx.loaded.ladder_id,
    ctx.item.id,
    drill.id,
    input.question_id,
    JSON.stringify(keptHits),
    JSON.stringify(flagsHit),
    passed ? 1 : 0,
    row.answered_at,
  );
  return {
    passed,
    kept_hits: keptHits,
    dropped: [...new Set(dropped)],
    missed_points: drill.key_points.filter((k) => !keptHits.includes(k.id)),
    red_flags_hit: flagsHit,
    study: ctx.item.study,
  };
}

/** Items that are Shown and whose drill gate is open now. */
export function drillsReady(db: Db, results: LadderStatuses[], now: Date = new Date()): string[] {
  const ready: string[] = [];
  for (const { loaded, statuses } of results) {
    for (const area of loaded.ladder.areas) {
      for (const items of Object.values(area.levels)) {
        for (const item of items) {
          const s = statuses.get(item.id);
          if (s?.state !== "shown" || s.shown_by === "drill") continue;
          if (gateFor(db, { loaded, item }, now).gate.allowed) ready.push(item.id);
        }
      }
    }
  }
  return ready;
}
