// Focus frames: the fixed part of each growth plan item, built by code from the developer's own evidence.
// The AI only writes the wording and one exercise; checkItemArea refuses a plan item that is not personal.
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { findItem, type LoadedLadder } from "./ladder/load.js";
import { LEVELS } from "./ladder/schema.js";
import { stackForPath, type StackHit } from "./stack.js";
import { areaLevel, type ItemState, type ItemStatus } from "./state.js";
import type { LadderStatuses } from "./status.js";

export interface FocusFrame {
  ladder_id: string;
  item_id: string;
  title: string;
  state: ItemState;
  needs: string[];
  stack: string | null;
  stack_note: { note: string; link: string; source: "ladder" | "local" } | null;
  study: string[];
  spot: { file: string; symbol: string | null } | null;
  evidence_ids: string[];
}

export interface FocusContext {
  /** Items with a fault that is still open. */
  recentFaultItems: Set<string>;
  /** "ladder_id:area_id" of areas the developer has evidence in. */
  workedAreas: Set<string>;
}

function priority(status: ItemStatus, faults: Set<string>): number {
  if (faults.has(status.item_id)) return 0;
  if (status.state === "shown") return 1;
  if (status.state === "learning") return 2;
  return 3;
}

/**
 * Up to `max` items to focus on: only in areas the developer works in, only at the level being worked on or the
 * next one, and only items with evidence. Open faults first, then Shown items (a drill away), then Learning
 * items with the most proofs. At most one per area while other areas still have candidates.
 */
export function pickFocus(results: LadderStatuses[], ctx: FocusContext, max = 3): { loaded: LoadedLadder; status: ItemStatus }[] {
  const byArea: { loaded: LoadedLadder; status: ItemStatus }[][] = [];
  for (const { loaded, statuses } of results) {
    for (const area of loaded.ladder.areas) {
      if (!ctx.workedAreas.has(`${loaded.ladder_id}:${area.id}`)) continue;
      const { working_toward } = areaLevel(area, statuses);
      if (working_toward === null) continue;
      const next = LEVELS[LEVELS.indexOf(working_toward) + 1];
      const allowed = new Set([working_toward, ...(next ? [next] : [])]);
      const candidates = LEVELS.filter((l) => allowed.has(l))
        .flatMap((l) => area.levels[l])
        .map((item) => statuses.get(item.id)!)
        .filter((s) => s.state === "learning" || s.state === "shown" || (s.state === "not_assessed" && s.proofs > 0))
        .map((status) => ({ loaded, status }));
      if (candidates.length > 0) byArea.push(candidates);
    }
  }
  const order = (a: { status: ItemStatus }, b: { status: ItemStatus }) =>
    priority(a.status, ctx.recentFaultItems) - priority(b.status, ctx.recentFaultItems) || b.status.proofs - a.status.proofs;
  for (const list of byArea) list.sort(order);
  const firsts = byArea.map((list) => list[0]!).sort(order);
  const picked = firsts.slice(0, max);
  if (picked.length < max) picked.push(...byArea.flatMap((list) => list.slice(1)).sort(order).slice(0, max - picked.length));
  return picked.sort(order);
}

/** The fixed frame for one focus item: what is missing, a real spot in the developer's code, the stack note. */
export function buildFrame(db: Db, status: ItemStatus, ctx: { ladder: LoadedLadder; stacks: StackHit[] }): FocusFrame {
  const found = findItem(ctx.ladder.ladder, status.item_id);
  if (!found) throw new StoreError(`Unknown ladder item '${status.item_id}'`);
  const item = found.item;
  const ladderId = ctx.ladder.ladder_id;
  const spotRow = (db
    .prepare(
      `SELECT file_path, symbol FROM skill_evidence
       WHERE ladder_id = ? AND item_id = ? AND disagreed_at IS NULL AND file_path IS NOT NULL
         AND ((polarity = 'negative' AND fixed_at IS NULL) OR (polarity = 'positive' AND (author = 'dev' OR decided_by = 'dev')))
       ORDER BY CASE WHEN polarity = 'negative' THEN 0 ELSE 1 END, at DESC LIMIT 1`,
    )
    .get(ladderId, item.id) ?? null) as { file_path: string; symbol: string | null } | null;
  const spot = spotRow ? { file: spotRow.file_path, symbol: spotRow.symbol } : null;
  const stack = (spot ? stackForPath(ctx.stacks, spot.file, ctx.ladder.track) : null) ?? ctx.stacks.find((s) => s.track === ctx.ladder.track)?.stack_id ?? null;

  let stackNote: FocusFrame["stack_note"] = null;
  if (stack !== null) {
    const fromLadder = item.stack_notes[stack];
    if (fromLadder) stackNote = { ...fromLadder, source: "ladder" };
    else {
      const local = db.prepare("SELECT note, link FROM stack_notes_local WHERE ladder_id = ? AND item_id = ? AND stack_id = ?").get(ladderId, item.id, stack) as
        | { note: string; link: string }
        | undefined;
      if (local) stackNote = { ...local, source: "local" };
    }
  }

  const ids = [
    ...(db.prepare("SELECT id FROM skill_evidence WHERE ladder_id = ? AND item_id = ? AND disagreed_at IS NULL ORDER BY at DESC").all(ladderId, item.id) as { id: string }[]),
    ...(db.prepare("SELECT id FROM pending_questions WHERE ladder_id = ? AND item_id = ? AND rating IS NOT NULL").all(ladderId, item.id) as { id: string }[]),
    ...(db.prepare("SELECT id FROM drill_attempts WHERE ladder_id = ? AND item_id = ? AND void = 0").all(ladderId, item.id) as { id: string }[]),
  ].map((r) => r.id);

  return {
    ladder_id: ladderId,
    item_id: item.id,
    title: item.title,
    state: status.state,
    needs: status.needs,
    stack,
    stack_note: stackNote,
    study: item.study,
    spot,
    evidence_ids: ids.slice(0, 20),
  };
}

/** Saves a best-practice note the AI wrote for a stack the ladder does not cover. Written once, reused after. */
export function saveStackNote(db: Db, loaded: LoadedLadder, input: { item_id: string; stack_id: string; note: string; link: string }): { saved: true } {
  const found = findItem(loaded.ladder, input.item_id);
  if (!found) throw new StoreError(`Unknown ladder item '${input.item_id}'`);
  if (found.item.stack_notes[input.stack_id]) throw new StoreError(`The ladder already has a note for ${input.stack_id}; use that one`);
  if (!/^https:\/\/\S+$/.test(input.link)) throw new StoreError("Stack note links must start with https://");
  db.prepare("INSERT OR REPLACE INTO stack_notes_local (ladder_id, item_id, stack_id, note, link) VALUES (?, ?, ?, ?, ?)").run(
    loaded.ladder_id,
    input.item_id,
    input.stack_id,
    input.note,
    input.link,
  );
  return { saved: true };
}

export interface ItemArea {
  item_id: string;
  ladder_id: string;
  evidence_ids: string[];
  spot?: { file: string; symbol?: string | null } | undefined;
  exercise: string;
}

/** Refuses a plan item that is not personal: evidence must be of that item, and the exercise must name a real spot or the next ticket. */
export function checkItemArea(db: Db, area: ItemArea): void {
  const ofItem = [
    db.prepare("SELECT 1 FROM skill_evidence WHERE id = ? AND ladder_id = ? AND item_id = ?"),
    db.prepare("SELECT 1 FROM pending_questions WHERE id = ? AND ladder_id = ? AND item_id = ? AND rating IS NOT NULL"),
    db.prepare("SELECT 1 FROM drill_attempts WHERE id = ? AND ladder_id = ? AND item_id = ?"),
  ];
  for (const id of area.evidence_ids) {
    if (!ofItem.some((q) => q.get(id, area.ladder_id, area.item_id))) throw new StoreError(`'${id}' is not evidence for ${area.item_id}`);
  }
  if (area.spot) {
    const base = area.spot.file.replaceAll("\\", "/").split("/").pop() ?? area.spot.file;
    if (!area.exercise.toLowerCase().includes(base.toLowerCase())) throw new StoreError(`The exercise must name the spot's file (${base}), so it is about the developer's own code`);
  } else if (!/\bticket\b/i.test(area.exercise)) {
    throw new StoreError("Give the exercise a real spot in the developer's code, or tie it to their next ticket");
  }
}
