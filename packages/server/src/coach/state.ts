// The state engine: plain code that turns stored evidence into an item's state and an area's level.
// The AI never decides a state. Every rule below comes from the design (spec 6.3, 6.6 and 11.2) and has a test.
import type { Exposure, ExposureLevel } from "./exposure.js";
import { LEVELS, type Area, type Level, type LadderItem, type Thresholds } from "./ladder/schema.js";

/**
 * not_seen: nothing at all. not_assessed: some evidence or chances, not enough to judge, and no sign of a gap.
 * learning: a sign of a gap. shown: the work and explanation criteria were met (or, with little chance in the work,
 * two drills and a clear answer). proven: shown in the work, plus a passed drill.
 */
export type ItemState = "not_seen" | "not_assessed" | "learning" | "shown" | "proven";

export interface EvidenceFact {
  id: string;
  kind: "rule" | "judge" | "decision" | "review" | "ticket_check";
  polarity: "positive" | "negative";
  author: "ai" | "dev" | "unknown";
  decided_by: "ai" | "dev" | null;
  /** From the scan of past commits (stage 2). Counts for at most 1 proof. */
  history: boolean;
  regresses: boolean;
  signal_id: string | null;
  file: string | null;
  symbol: string | null;
  ticket: string;
  at: string;
  fixed_at: string | null;
  fixed_ticket: string | null;
  disagreed: boolean;
}

export interface AnswerFact {
  id: string;
  rating: "clear" | "partial" | "not_yet";
  ticket: string;
  names_tradeoff: boolean;
  at: string;
}

export interface DrillFact {
  id: string;
  drill_id: string;
  passed: boolean;
  void: boolean;
  at: string;
}

export interface ItemStatus {
  item_id: string;
  state: ItemState;
  proofs: number;
  proof_tickets: number;
  clear_answers: number;
  tradeoff_named: boolean;
  open_faults: number;
  regressed_at: string | null;
  last_proof_at: string | null;
  proven_at: string | null;
  needs: string[];
  exposure: ExposureLevel;
  exposure_functions: number;
  /** How Shown was reached: in the work, or by drills when the work gave little chance. Null when not Shown. */
  shown_by: "work" | "drill" | null;
  shown_at: string | null;
}

export interface ItemInput {
  item: LadderItem;
  evidence: EvidenceFact[];
  answers: AnswerFact[];
  drills: DrillFact[];
  /** Chances in the work to use the skill. Missing means none. */
  exposure?: Exposure;
}

const DAY = 86_400_000;
const ms = (iso: string) => Date.parse(iso);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const baseName = (path: string) => path.replaceAll("\\", "/").split("/").pop() ?? path;

/** Credit: the developer wrote the line or made the decision. AI code alone never counts. */
function isCredit(e: EvidenceFact): boolean {
  return e.polarity === "positive" && (e.author === "dev" || e.decided_by === "dev");
}

/** A fault counts whoever wrote it, unless it was fixed in the same ticket, before it shipped. */
function isFault(e: EvidenceFact): boolean {
  return e.polarity === "negative" && !(e.fixed_ticket !== null && e.fixed_ticket === e.ticket);
}

interface Snapshot {
  shown: boolean;
  proofs: number;
  proofTickets: number;
  openFaults: EvidenceFact[];
  clearTickets: number;
  tradeoff: boolean;
  lastProofAt: string | null;
}

/** Is the item Shown at time `at`, using only facts dated up to then and after the regression point? */
function snapshot(input: ItemInput, credits: EvidenceFact[], faults: EvidenceFact[], regressedAt: number | null, at: number, t: Thresholds): Snapshot {
  const counts = (iso: string) => (regressedAt === null || ms(iso) > regressedAt) && ms(iso) <= at;
  const windowStart = at - t.window_days * DAY;

  // One proof per (signal, file, function), ticketed by its earliest row.
  const groups = new Map<string, EvidenceFact>();
  for (const e of credits) {
    if (!counts(e.at) || ms(e.at) < windowStart) continue;
    // Rule hits group by signal; judge and decision rows by their kind, so the same function counts once.
    const key = [e.signal_id ?? e.kind, e.file ?? "", e.symbol ?? ""].join("\0");
    const prev = groups.get(key);
    if (!prev || ms(e.at) < ms(prev.at)) groups.set(key, e);
  }
  // The judge cap protects items the rules can prove. An item with no positive signal can only be proven by judge evidence.
  const hasSignals = input.item.signals.some((s) => s.polarity === "positive");
  let judged = 0;
  let fromHistory = 0;
  const kept: EvidenceFact[] = [];
  for (const e of [...groups.values()].sort((a, b) => ms(a.at) - ms(b.at))) {
    if (e.kind === "judge" && hasSignals) {
      if (judged >= t.judge_cap) continue;
      judged++;
    }
    if (e.history) {
      if (fromHistory >= 1) continue;
      fromHistory++;
    }
    kept.push(e);
  }
  const proofTickets = new Set(kept.map((e) => e.ticket)).size;
  const openFaults = faults.filter((f) => ms(f.at) >= windowStart && ms(f.at) <= at && (f.fixed_at === null || ms(f.fixed_at) > at));
  const clear = input.answers.filter((a) => a.rating === "clear" && counts(a.at));
  const clearTickets = new Set(clear.map((a) => a.ticket)).size;
  const tradeoff = clear.some((a) => a.names_tradeoff);
  const lastProof = kept.length > 0 ? kept[kept.length - 1]!.at : null;
  return {
    shown: kept.length >= t.proofs && proofTickets >= t.tickets && openFaults.length === 0 && clearTickets >= t.clear_answers && tradeoff,
    proofs: kept.length,
    proofTickets,
    openFaults,
    clearTickets,
    tradeoff,
    lastProofAt: lastProof,
  };
}

export function itemStatus(input: ItemInput, now: Date, t: Thresholds): ItemStatus {
  // Disagreeing removes credit, never a fault: so "I disagree" can only lower a state, never raise it.
  const credits = input.evidence.filter((e) => !e.disagreed).filter(isCredit);
  const faults = input.evidence.filter(isFault);

  // The regression point: the latest serious fault or "not yet" answer. Only newer facts count after it.
  const drops = [...faults.filter((f) => f.regresses).map((f) => f.at), ...input.answers.filter((a) => a.rating === "not_yet").map((a) => a.at)];
  const regressedIso = drops.length > 0 ? drops.reduce((a, b) => (ms(a) >= ms(b) ? a : b)) : null;
  const regressedAt = regressedIso === null ? null : ms(regressedIso);

  const exposure = input.exposure ?? { level: "none" as const, functions: 0 };
  const after = (iso: string) => regressedAt === null || ms(iso) > regressedAt;
  const nowMs = now.getTime();
  const current = snapshot(input, credits, faults, regressedAt, nowMs, t);

  // Shown in the work is sticky: once reached after the regression point, it stays until the next regression,
  // so a developer is never pulled back for working on other things. Checked at each fact's moment and now.
  const moments = [...new Set([...credits.map((e) => e.at), ...input.answers.map((a) => a.at)].filter(after).map(ms))]
    .filter((m) => m <= nowMs)
    .sort((a, b) => a - b);
  moments.push(nowMs);
  const workShownMs = moments.find((m) => snapshot(input, credits, faults, regressedAt, m, t).shown) ?? null;

  // With little chance in the work: two passed drills on different prompts and one clear answer.
  const passed = input.drills.filter((d) => d.passed && !d.void && after(d.at)).sort((a, b) => ms(a.at) - ms(b.at));
  const firstClear = input.answers.filter((a) => a.rating === "clear" && after(a.at)).sort((a, b) => ms(a.at) - ms(b.at))[0];
  const distinct: DrillFact[] = [];
  for (const d of passed) if (!distinct.some((x) => x.drill_id === d.drill_id)) distinct.push(d);
  const drillShownMs = distinct.length >= 2 && firstClear ? Math.max(ms(distinct[1]!.at), ms(firstClear.at)) : null;

  // Proven needs Shown in the work: a drill passed at or after that moment. Drills alone never prove an item.
  const proven = workShownMs === null ? undefined : passed.find((d) => ms(d.at) >= workShownMs);

  // A gap: a regression, an open fault, a weak latest answer, or a failed latest drill with no pass after it.
  const openFault = faults.some((f) => f.fixed_at === null && after(f.at));
  const rated = [...input.answers].sort((a, b) => ms(a.at) - ms(b.at));
  const latestAnswer = rated[rated.length - 1];
  const tries = input.drills.filter((d) => !d.void).sort((a, b) => ms(a.at) - ms(b.at));
  const latestDrill = tries[tries.length - 1];
  const gap =
    regressedAt !== null || openFault || (latestAnswer !== undefined && latestAnswer.rating !== "clear") || (latestDrill !== undefined && !latestDrill.passed);

  const anything = credits.length > 0 || input.answers.length > 0 || input.drills.length > 0 || faults.length > 0 || exposure.functions > 0;
  let state: ItemState;
  let shownBy: ItemStatus["shown_by"] = null;
  let shownMs: number | null = null;
  if (proven) {
    state = "proven";
    shownBy = "work";
    shownMs = workShownMs;
  } else if (workShownMs !== null) {
    state = "shown";
    shownBy = "work";
    shownMs = workShownMs;
  } else if (drillShownMs !== null) {
    state = "shown";
    shownBy = "drill";
    shownMs = drillShownMs;
  } else if (gap) state = "learning";
  else if (anything) state = "not_assessed";
  else state = "not_seen";

  const lowExposure = exposure.level === "none" || exposure.level === "low";
  const needs: string[] = [];
  if (state === "shown") needs.push(shownBy === "drill" ? "show it in your work, then pass a drill" : "pass a drill");
  else if (state !== "proven") {
    if (lowExposure) {
      needs.push("more chances in your work, or take a drill");
      // The drill-only path, spelled out, so nobody is told a drill cannot help.
      if (distinct.length < 2) needs.push(`or by drills: pass ${plural(2 - distinct.length, "more drill", "more drills")} on a new prompt`);
      if (!firstClear) needs.push("or by drills: 1 clear answer to a follow-up question");
    }
    if (current.proofs < t.proofs) needs.push(`${plural(t.proofs - current.proofs, "more code proof", "more code proofs")}`);
    if (current.proofTickets < t.tickets) needs.push(`proof on ${plural(t.tickets - current.proofTickets, "more ticket", "more tickets")}`);
    for (const file of new Set(current.openFaults.map((f) => f.file ?? "your code"))) needs.push(`fix the open fault in ${baseName(file)}`);
    if (current.clearTickets < t.clear_answers) needs.push(`${plural(t.clear_answers - current.clearTickets, "more clear answer", "more clear answers")}`);
    if (!current.tradeoff) needs.push("an answer that names the trade-off");
  }

  return {
    item_id: input.item.id,
    state,
    proofs: current.proofs,
    proof_tickets: current.proofTickets,
    clear_answers: current.clearTickets,
    tradeoff_named: current.tradeoff,
    open_faults: current.openFaults.length,
    regressed_at: regressedIso,
    last_proof_at: current.lastProofAt,
    proven_at: proven?.at ?? null,
    needs,
    exposure: exposure.level,
    exposure_functions: exposure.functions,
    shown_by: shownBy,
    shown_at: shownMs === null ? null : new Date(shownMs).toISOString(),
  };
}

/** The highest level whose items, and all lower ones, are Proven. Empty levels are passed through. */
export function areaLevel(area: Area, statuses: Map<string, ItemStatus>): { level: Level | null; working_toward: Level | null } {
  let level: Level | null = null;
  for (const lvl of LEVELS) {
    const items = area.levels[lvl];
    if (items.length === 0) continue;
    if (items.every((i) => statuses.get(i.id)?.state === "proven")) level = lvl;
    else return { level, working_toward: lvl };
  }
  return { level, working_toward: null };
}
