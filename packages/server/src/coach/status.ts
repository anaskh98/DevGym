// Coach status: catch up on commits, work out every item's state with plain code, and build the progress view.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { commitDiff } from "../git/diff.js";
import { currentBranch, defaultBranchCommits, developerEmails, repoTopLevel } from "../git/log.js";
import { run, type Run } from "../pointers/git.js";
import { isSupported, symbolAtLine } from "../pointers/symbols.js";
import { aiHashesFor, lineHash, normalizeLine } from "./attribution.js";
import { catchUp, ticketForCommit, type CatchUpResult } from "./capture.js";
import { repeats, scanShippedBugs, type Repeat } from "./bugs.js";
import { repoIdentity } from "../git/identity.js";
import { drillsReady } from "./drills.js";
import { exposureFor, type ExposureLevel } from "./exposure.js";
import { toIso, factsForItem } from "./facts.js";
import { findItem, loadActiveLadders, loadLadder, type LoadedLadder } from "./ladder/load.js";
import { LEVELS, type LadderItem, type Level, type Track } from "./ladder/schema.js";
import { buildFrame, pickFocus, type FocusFrame } from "./plan.js";
import { proposeQuestions, type QuestionView } from "./questions.js";
import { getExtraEmails, getTracks } from "./settings.js";
import { detectStacks, type StackHit } from "./stack.js";
import { areaLevel, itemStatus, type ItemState, type ItemStatus } from "./state.js";

export interface AreaView {
  ladder_id: string;
  area_id: string;
  name: string;
  /** The highest exposure among the area's items: how much the work touches this area. */
  exposure: ExposureLevel;
  level: Level | null;
  working_toward: Level | null;
  items: { item_id: string; title: string; level: Level; state: ItemState; exposure: ExposureLevel; detail: string }[];
}

export interface CoachStatus {
  tracks: Track[];
  ladders: { ladder_id: string; track: Track; source: string; warning?: string }[];
  stacks: StackHit[];
  catch_up: CatchUpResult;
  /** Progress of the one-time read of older commits. */
  history_scan: CatchUpResult;
  /** Mistakes on 3 or more tickets, newest first. Some reached main as bugs. */
  repeats: Repeat[];
  areas: AreaView[];
  /** Areas the ladder has not written yet, by name. */
  not_written: string[];
  focus: FocusFrame[];
  questions: QuestionView[];
  drills_ready: string[];
  text: string;
}

export interface StatusOptions {
  root: string;
  now?: Date;
  exec?: Run;
  /** Folder that holds the developer's home-level ladder file. Defaults to the real home folder. */
  home?: string;
}

/** Everything code works out for one ladder: each item's status. */
export interface LadderStatuses {
  loaded: LoadedLadder;
  statuses: Map<string, ItemStatus>;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function trackOfItem(itemId: string): Track {
  return itemId.startsWith("FE.") ? "frontend" : "backend";
}

/** Each written item's status for one ladder. Items not in the ladder are never looked at. */
export function computeStatuses(db: Db, loaded: LoadedLadder, now: Date): Map<string, ItemStatus> {
  const statuses = new Map<string, ItemStatus>();
  for (const area of loaded.ladder.areas) {
    for (const level of LEVELS) {
      for (const item of area.levels[level]) {
        const exposure = exposureFor(db, loaded.ladder_id, item.id, now, loaded.thresholds);
        statuses.set(item.id, itemStatus({ item, ...factsForItem(db, loaded.ladder_id, item.id), exposure }, now, loaded.thresholds));
      }
    }
  }
  return statuses;
}

function reasonFor(s: ItemStatus): string {
  switch (s.state) {
    case "proven":
      return "passed a drill while shown";
    case "shown":
      return s.shown_by === "drill"
        ? "passed 2 drills and gave a clear answer, with little chance in the work"
        : `${s.proofs} code proofs on ${s.proof_tickets} tickets and ${s.clear_answers} clear answers`;
    case "learning":
      return s.regressed_at !== null ? "dropped back after a serious fault or a 'not yet' answer" : "a gap: an open fault, a weak answer or a failed drill";
    case "not_assessed":
      return "some evidence, not enough to judge yet";
    default:
      return "its evidence was removed";
  }
}

/** Writes a history row for every item whose state differs from its last recorded one. Returns how many. */
export function recordStateChanges(db: Db, ladderId: string, statuses: ItemStatus[], reason: (s: ItemStatus) => string = reasonFor): number {
  const last = db.prepare("SELECT to_state FROM item_state_history WHERE ladder_id = ? AND item_id = ? ORDER BY rowid DESC LIMIT 1");
  const insert = db.prepare("INSERT INTO item_state_history (id, ladder_id, item_id, from_state, to_state, reason) VALUES (?, ?, ?, ?, ?, ?)");
  let written = 0;
  for (const s of statuses) {
    const from = (last.get(ladderId, s.item_id) as { to_state: string } | undefined)?.to_state ?? "not_seen";
    if (from === s.state) continue;
    insert.run(randomUUID(), ladderId, s.item_id, from, s.state, reason(s));
    written++;
  }
  return written;
}

export function stateHistory(db: Db, ladderId?: string): { ladder_id: string; item_id: string; from_state: string; to_state: string; reason: string; at: string }[] {
  const rows = (
    ladderId === undefined
      ? db.prepare("SELECT ladder_id, item_id, from_state, to_state, reason, at FROM item_state_history ORDER BY rowid").all()
      : db.prepare("SELECT ladder_id, item_id, from_state, to_state, reason, at FROM item_state_history WHERE ladder_id = ? ORDER BY rowid").all(ladderId)
  ) as { ladder_id: string; item_id: string; from_state: string; to_state: string; reason: string; at: string }[];
  return rows.map((r) => ({ ...r, at: toIso(r.at) }));
}

function detail(s: ItemStatus, proofsNeeded: number): string {
  switch (s.state) {
    case "proven":
      return s.proven_at ? `drill passed ${shortDate(s.proven_at)}` : "drill passed";
    case "shown":
      return s.shown_by === "drill" ? "shown by drills · show it in your work to reach Proven" : `ready for a drill → /coach drill ${s.item_id}`;
    case "not_assessed":
      return s.exposure === "none" || s.exposure === "low"
        ? `little chance in your work · drill available → /coach drill ${s.item_id}`
        : `${s.proofs} of ${proofsNeeded} code proofs · not enough to judge yet`;
    case "learning": {
      const parts = [`${s.proofs} of ${proofsNeeded} code proofs`];
      if (s.open_faults > 0) parts.push(`${s.open_faults} open fault${s.open_faults === 1 ? "" : "s"}`);
      if (s.needs[0] && !s.needs[0].includes("code proof")) parts.push(`next: ${s.needs[0]}`);
      return parts.join(" · ");
    }
    default:
      return "";
  }
}

export function areaViews(results: LadderStatuses[]): { areas: AreaView[]; notWritten: string[] } {
  const areas: AreaView[] = [];
  const notWritten: string[] = [];
  for (const { loaded, statuses } of results) {
    for (const area of loaded.ladder.areas) {
      const items = LEVELS.flatMap((level) => area.levels[level].map((item) => ({ item, level })));
      if (items.length === 0) {
        notWritten.push(`${area.name} (${loaded.track})`);
        continue;
      }
      const { level, working_toward } = areaLevel(area, statuses);
      const order: ExposureLevel[] = ["none", "low", "medium", "high"];
      const exposure = items.reduce<ExposureLevel>((best, { item }) => {
        const e = statuses.get(item.id)!.exposure;
        return order.indexOf(e) > order.indexOf(best) ? e : best;
      }, "none");
      areas.push({
        ladder_id: loaded.ladder_id,
        area_id: area.id,
        name: area.name,
        exposure,
        level,
        working_toward,
        items: items.map(({ item, level: itemLevel }) => {
          const s = statuses.get(item.id)!;
          return { item_id: item.id, title: item.title, level: itemLevel, state: s.state, exposure: s.exposure, detail: detail(s, loaded.thresholds.proofs) };
        }),
      });
    }
  }
  return { areas, notWritten };
}

/** The progress view, as plain text for the terminal. */
export function renderProgress(s: Omit<CoachStatus, "text">): string {
  if (s.tracks.length === 0) return "Coach needs to know what you work on: backend, frontend, or both?";
  const lines: string[] = [];
  for (const area of s.areas) {
    const track = area.ladder_id.endsWith("/frontend") ? "Frontend" : "Backend";
    const levelText = area.level ? capital(area.level) : "Starting";
    lines.push(`${track} · ${area.name}        Level: ${levelText}${area.working_toward ? `  ·  working toward ${capital(area.working_toward)}` : ""}  ·  exposure: ${area.exposure}`);
    const shownLevel = area.working_toward ?? area.level;
    const nextLevel = shownLevel ? LEVELS[LEVELS.indexOf(shownLevel) + 1] : undefined;
    const width = Math.max(...area.items.map((i) => `${i.item_id} ${i.title}`.length));
    // The level being worked on, plus any other item that already has evidence or is proven.
    const visible = area.items.filter((i) => i.level === shownLevel || i.state !== "not_seen");
    for (const item of visible) {
      const label = `${item.item_id} ${item.title}`.padEnd(width + 2);
      lines.push(`  ${label}${item.state.toUpperCase().replace("_", " ").padEnd(14)}${item.detail}`);
    }
    const next = nextLevel ? area.items.find((i) => i.level === nextLevel) : undefined;
    if (next) lines.push(`  Next for ${capital(nextLevel!)}: ${next.item_id} ${next.title}    ${next.state.toUpperCase().replace("_", " ")}`);
    lines.push("");
  }
  if (s.repeats.length > 0) {
    lines.push("Repeats (whole history)");
    for (const r of s.repeats.slice(0, 5)) {
      const when = r.coming_back ? `last: ${r.last_at.slice(0, 10)}` : "nothing new in 60 days: fixed habit?";
      lines.push(`  ${r.item_id} ${r.signal_id}   ${r.times} times · ${r.tickets} tickets${r.shipped > 0 ? ` · ${r.shipped} reached main as bugs` : ""} · ${when}`);
    }
    lines.push("");
  }
  const stacks = s.stacks.filter((h) => s.tracks.includes(h.track));
  lines.push(`Your stack: ${stacks.length > 0 ? stacks.map((h) => (h.folder ? `${h.stack_id} (${h.folder})` : h.stack_id)).join(", ") : "not found in this repo"}`);
  const study = [...new Set(s.focus.flatMap((f) => f.study))].slice(0, 3);
  if (study.length > 0) lines.push(`Study next: ${study.join(" · ")}`);
  if (s.not_written.length > 0) lines.push(`Not written yet: ${s.not_written.join(", ")}`);
  return lines.join("\n");
}

/** Up to 3 focus items, each with its fixed frame. */
function focusFrames(db: Db, results: LadderStatuses[], stacks: StackHit[]): FocusFrame[] {
  const recentFaultItems = new Set<string>(repeats(db).filter((r) => r.coming_back).map((r) => r.item_id));
  const workedAreas = new Set<string>();
  for (const { loaded, statuses } of results) {
    for (const s of statuses.values()) if (s.open_faults > 0) recentFaultItems.add(s.item_id);
    const items = db.prepare("SELECT DISTINCT item_id FROM skill_evidence WHERE ladder_id = ? AND disagreed_at IS NULL").all(loaded.ladder_id) as { item_id: string }[];
    for (const { item_id } of items) {
      const found = findItem(loaded.ladder, item_id);
      if (found) workedAreas.add(`${loaded.ladder_id}:${found.area.id}`);
    }
  }
  return pickFocus(results, { recentFaultItems, workedAreas }).map(({ loaded, status }) => buildFrame(db, status, { ladder: loaded, stacks }));
}

/** Loads the active ladders, catches up on commits, and works out every state. */
export async function coachStatus(db: Db, opts: StatusOptions): Promise<CoachStatus> {
  const now = opts.now ?? new Date();
  const tracks = getTracks(db);
  const base = {
    tracks,
    ladders: [] as CoachStatus["ladders"],
    stacks: [] as StackHit[],
    catch_up: { started: false, note: "Pick your tracks first.", commits_read: 0, evidence_added: 0, faults_fixed: 0, more_left: false } as CatchUpResult,
    history_scan: { started: false, commits_read: 0, evidence_added: 0, faults_fixed: 0, more_left: false } as CatchUpResult,
    repeats: [] as Repeat[],
    areas: [] as AreaView[],
    not_written: [] as string[],
    focus: [] as FocusFrame[],
    questions: [] as QuestionView[],
    drills_ready: [] as string[],
  };
  if (tracks.length === 0) return { ...base, text: renderProgress(base) };

  const top = (await repoTopLevel(opts.root, opts.exec ?? run)) ?? opts.root;
  const ladders = loadActiveLadders(tracks, { repoRoot: top, ...(opts.home ? { home: opts.home } : {}) });
  const stacks = detectStacks(top);
  const catch_up = await catchUp(db, { root: opts.root, ladders, extraEmails: getExtraEmails(db), now, ...(opts.exec ? { exec: opts.exec } : {}) });
  // The developer's older commits, one batch per run: faults count fully, credit is capped (spec 6.4.1).
  const history_scan = await catchUp(db, { root: opts.root, ladders, extraEmails: getExtraEmails(db), now, history: true, ...(opts.exec ? { exec: opts.exec } : {}) });
  try {
    await scanShippedBugs(db, { root: opts.root, ladders, now, ...(opts.exec ? { exec: opts.exec } : {}) });
  } catch {
    // Bug scanning is best effort: the rest of the view must still work.
  }
  const repeatList = repeats(db, now);
  const results = ladders.map((loaded) => ({ loaded, statuses: computeStatuses(db, loaded, now) }));
  for (const r of results) recordStateChanges(db, r.loaded.ladder_id, [...r.statuses.values()]);
  const { areas, notWritten } = areaViews(results);
  const questions = proposeQuestions(db, results, ladders[0]?.thresholds.max_questions ?? 3);
  const focus = focusFrames(db, results, stacks);
  const status = {
    ...base,
    ladders: ladders.map((l) => ({ ladder_id: l.ladder_id, track: l.track, source: l.source, ...(l.warning ? { warning: l.warning } : {}) })),
    stacks,
    catch_up,
    history_scan,
    repeats: repeatList,
    areas,
    not_written: notWritten,
    focus,
    questions,
    drills_ready: drillsReady(db, results, now),
  };
  return { ...status, text: renderProgress(status) };
}

/** Reads the developer's new commits for the chosen tracks. Every Coach command that judges a state runs this first. */
export async function catchUpHere(db: Db, opts: StatusOptions): Promise<CatchUpResult | null> {
  const tracks = getTracks(db);
  if (tracks.length === 0) return null;
  const top = (await repoTopLevel(opts.root, opts.exec ?? run)) ?? opts.root;
  const ladders = loadActiveLadders(tracks, { repoRoot: top, ...(opts.home ? { home: opts.home } : {}) });
  return catchUp(db, { root: opts.root, ladders, extraEmails: getExtraEmails(db), ...(opts.now ? { now: opts.now } : {}), ...(opts.exec ? { exec: opts.exec } : {}) });
}

/** The active ladder for an item's track, or the one named. Throws when the item is not in it. */
export function ladderForItem(root: string, itemId: string, opts: { ladderId?: string; home?: string } = {}): { loaded: LoadedLadder; item: LadderItem } {
  const loaded = loadLadder(trackOfItem(itemId), { repoRoot: root, ...(opts.home ? { home: opts.home } : {}) });
  if (opts.ladderId !== undefined && opts.ladderId !== loaded.ladder_id) {
    throw new StoreError(`Ladder '${opts.ladderId}' is not the active ladder here (that is '${loaded.ladder_id}')`);
  }
  const found = findItem(loaded.ladder, itemId);
  if (!found) throw new StoreError(`Unknown ladder item '${itemId}'. Item ids look like BE.ERR.M2`);
  return { loaded, item: found.item };
}

/** Everything stored about one item, for "/coach why". */
export function itemDetail(db: Db, loaded: LoadedLadder, item: LadderItem, now: Date = new Date()) {
  const facts = factsForItem(db, loaded.ladder_id, item.id);
  const exposure = exposureFor(db, loaded.ladder_id, item.id, now, loaded.thresholds);
  const status = itemStatus({ item, ...facts, exposure }, now, loaded.thresholds);
  const evidence = db
    .prepare(
      "SELECT id, kind, polarity, author, decided_by, file_path, symbol, ticket, signal_id, note, at, fixed_at, fixed_ticket, disagreed_at, disagree_reason FROM skill_evidence WHERE ladder_id = ? AND item_id = ? ORDER BY at",
    )
    .all(loaded.ladder_id, item.id)
    .map((r) => ({ ...r }));
  const answers = db
    .prepare("SELECT id, kind, question, answer, rating, names_tradeoff, ticket, answered_at FROM pending_questions WHERE ladder_id = ? AND item_id = ? AND answered_at IS NOT NULL ORDER BY answered_at")
    .all(loaded.ladder_id, item.id)
    .map((r) => ({ ...r }));
  const drills = db
    .prepare("SELECT id, drill_id, hits, red_flags, passed, void, created_at FROM drill_attempts WHERE ladder_id = ? AND item_id = ? ORDER BY created_at")
    .all(loaded.ladder_id, item.id)
    .map((r) => ({ ...r }));
  return { ladder_id: loaded.ladder_id, item: { id: item.id, title: item.title, good_looks_like: item.good_looks_like, study: item.study }, status, evidence, answers, drills };
}

export interface ProposeEvidenceInput {
  item_id: string;
  ladder_id?: string;
  commit: string;
  file: string;
  line_start: number;
  line_end: number;
  why: string;
}

/**
 * Lets the AI add positive evidence, but only with a citation the server checks: the lines must be added in that
 * commit, the commit must be the developer's, and at least one of the lines must be developer-written.
 */
export async function proposeEvidence(db: Db, root: string, input: ProposeEvidenceInput, exec: Run = run): Promise<{ evidence_id: string }> {
  const identity = await repoIdentity(root, exec);
  if (identity === null) throw new StoreError("This folder is not a git repo");
  const { top, key } = identity;
  const { loaded } = ladderForItem(top, input.item_id, input.ladder_id === undefined ? {} : { ladderId: input.ladder_id });
  if (input.line_end < input.line_start) throw new StoreError("line_end must not be before line_start");

  const info = await exec("git", ["show", "-s", "--format=%H%x1f%ae%x1f%aI%x1f%s", input.commit], top);
  if (info.code !== 0) throw new StoreError(`Commit '${input.commit}' was not found`);
  const [sha = "", email = "", authorDate = "", subject = ""] = info.stdout.trim().split("\x1f");
  const emails = await developerEmails(top, getExtraEmails(db), exec);
  if (!emails.includes(email.toLowerCase())) throw new StoreError("That commit is not the developer's, so it cannot count as their evidence");

  const file = (await commitDiff(top, sha, exec)).find((f) => f.path === input.file.replaceAll("\\", "/"));
  const lines = (file?.added ?? []).filter((l) => l.line >= input.line_start && l.line <= input.line_end);
  if (lines.length === 0) throw new StoreError(`Lines ${input.line_start}-${input.line_end} of ${input.file} were not added in that commit`);
  const ai = aiHashesFor(db, key, file!.path);
  const hashed = lines.map((l) => ({ line: l, normalized: normalizeLine(l.text) })).filter((l) => l.normalized !== null);
  // Every line that can be told apart must be the developer's: one developer line among AI lines is not enough.
  if (hashed.some((l) => ai.has(lineHash(l.normalized!)))) {
    throw new StoreError("Claude wrote some of those lines, so they cannot count as the developer's evidence. Cite only lines the developer wrote");
  }
  const devLine = hashed[0]?.line;
  if (!devLine) throw new StoreError("Those lines are too short to tell who wrote them");

  const source = await exec("git", ["show", `${sha}:${file!.path}`], top);
  const symbol = source.code === 0 && isSupported(file!.path) ? ((await symbolAtLine(file!.path, source.stdout, devLine.line))?.name ?? null) : null;
  const ticket = ticketForCommit({ sha, authorEmail: email, authorDate, subject }, { onDefault: (await defaultBranchCommits(top, exec)).has(sha), branch: await currentBranch(top, exec) });
  const id = randomUUID();
  db.prepare(
    "INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, repo_root, commit_sha, file_path, symbol, ticket, note, at) VALUES (?, ?, ?, 'judge', 'positive', 'dev', ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, loaded.ladder_id, input.item_id, key, sha, file!.path, symbol, ticket, input.why, authorDate);
  return { evidence_id: id };
}

/** The developer disagrees. This can lower a state, never raise it: evidence stops counting, a drill score is voided. */
export function disagree(db: Db, input: { target_id: string; reason: string }): { target: "evidence" | "drill"; effect: string } {
  const now = new Date().toISOString();
  const row = db.prepare("SELECT polarity FROM skill_evidence WHERE id = ?").get(input.target_id) as { polarity: string } | undefined;
  if (row) {
    db.prepare("UPDATE skill_evidence SET disagreed_at = ?, disagree_reason = ? WHERE id = ?").run(now, input.reason, input.target_id);
    return row.polarity === "positive"
      ? { target: "evidence", effect: "This proof no longer counts. Your reason is kept and shown with the item." }
      : { target: "evidence", effect: "Your reason is kept and shown with this fault. The fault still counts: disagreeing can only lower a state, never raise it. Fix the code to clear it." };
  }
  if (db.prepare("UPDATE drill_attempts SET void = 1 WHERE id = ?").run(input.target_id).changes > 0) {
    return { target: "drill", effect: "This drill score is void. You can take the drill again with a different question." };
  }
  throw new StoreError("You can disagree with evidence or a drill score. To change an answer, ask for a new question.");
}
