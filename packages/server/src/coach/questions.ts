// Coach questions: picked by code, worded by the AI, answered in the developer's own words.
// The answer is saved by the prompt hook exactly as typed, so the AI cannot write or improve it.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import type { RATINGS } from "../mcp/schemas.js";
import { DEFAULT_THRESHOLDS } from "./ladder/schema.js";
import { quoteIn } from "./quote.js";
import { signalById } from "./signals.js";
import type { LadderStatuses } from "./status.js";

export type Rating = (typeof RATINGS)[number];

export interface QuestionView {
  question_id: string;
  kind: "why" | "explain_back" | "drill";
  item_id: string;
  ticket: string;
  /** What to ask about: the decision summary, or the signal meaning with file and function. Never code. */
  about: string;
  opened: boolean;
}

/** Stored instead of an answer that the privacy check refused (it held code, a secret or a blocked name). */
export const HELD_BACK = "(held back: the answer contained code, a secret or a name on the denylist)";

interface QuestionRow {
  id: string;
  kind: QuestionView["kind"];
  ladder_id: string;
  item_id: string;
  ticket: string;
  target_ref: string | null;
  decision_id: string | null;
  question: string | null;
  opened_at: string | null;
  open_session: string | null;
  answer: string | null;
  answered_at: string | null;
  closed_reason: string | null;
  rating: string | null;
}

const EVIDENCE_REF = "evidence:";

interface EvidenceRow {
  id: string;
  polarity: string;
  signal_id: string | null;
  file_path: string | null;
  symbol: string | null;
  note: string | null;
  ticket: string;
}

function aboutEvidence(row: EvidenceRow): string {
  const meaning = (row.signal_id && signalById(row.signal_id)?.meaning) || row.note || "a choice";
  const where = row.file_path ? ` in ${row.file_path}${row.symbol ? ` (${row.symbol})` : ""}` : "";
  return `${row.polarity === "negative" ? "A fault: " : ""}${meaning}${where}`;
}

/** What a question is about, in words: worked out from what it points at, so no extra text is stored. */
function aboutFor(db: Db, row: QuestionRow): string {
  if (row.target_ref?.startsWith(EVIDENCE_REF)) {
    const e = db.prepare("SELECT id, polarity, signal_id, file_path, symbol, note, ticket FROM skill_evidence WHERE id = ?").get(row.target_ref.slice(EVIDENCE_REF.length)) as
      | EvidenceRow
      | undefined;
    if (e) return aboutEvidence(e);
  }
  if (row.decision_id !== null) {
    const d = db.prepare("SELECT summary FROM decisions WHERE id = ?").get(row.decision_id) as { summary: string } | undefined;
    if (d) return d.summary;
  }
  return row.question ?? "";
}

function view(db: Db, row: QuestionRow): QuestionView {
  return { question_id: row.id, kind: row.kind, item_id: row.item_id, ticket: row.ticket, about: aboutFor(db, row), opened: row.open_session !== null };
}

export function isLaterReply(text: string): boolean {
  return /^\s*(later|skip|not now|later please)\s*[.!]*\s*$/i.test(text);
}

/** A short message that ends with a question mark: the developer is asking back, not answering. */
export function isClarification(text: string): boolean {
  const t = text.trim();
  return t.length < 120 && t.endsWith("?");
}

/**
 * The questions to ask now, at most `max`: unanswered ones first, then new ones picked by code.
 * Never two questions on the same item.
 */
export function proposeQuestions(db: Db, results: LadderStatuses[], max: number): QuestionView[] {
  const active = new Map<string, Set<string>>(results.map((r) => [r.loaded.ladder_id, new Set(r.statuses.keys())]));
  const inLadder = (ladderId: string, itemId: string) => active.get(ladderId)?.has(itemId) === true;

  const pending = (
    db
      .prepare("SELECT * FROM pending_questions WHERE answered_at IS NULL AND kind != 'drill' AND (closed_reason IS NULL OR closed_reason IN ('later', 'timeout')) ORDER BY created_at, rowid")
      .all() as unknown as QuestionRow[]
  ).filter((q) => inLadder(q.ladder_id, q.item_id));
  const out: QuestionView[] = [];
  const usedItems = new Set<string>();
  for (const q of pending) {
    if (out.length >= max || usedItems.has(q.item_id)) continue;
    out.push(view(db, q));
    usedItems.add(q.item_id);
  }
  const insert = db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, target_ref, decision_id, ticket) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const devRows = db.prepare(
    "SELECT id, polarity, signal_id, file_path, symbol, note, ticket FROM skill_evidence WHERE ladder_id = ? AND item_id = ? AND author = 'dev' AND disagreed_at IS NULL ORDER BY at DESC",
  );
  const askedAbout = db.prepare("SELECT 1 FROM pending_questions WHERE target_ref = ? LIMIT 1");
  const clearTickets = db.prepare("SELECT DISTINCT ticket FROM pending_questions WHERE ladder_id = ? AND item_id = ? AND rating = 'clear'");
  /**
   * The newest evidence not asked about yet, preferring a ticket with no clear answer: Shown needs clear answers
   * on two different tickets, so a second question must be able to come from another ticket.
   */
  const nextEvidence = (ladderId: string, itemId: string): EvidenceRow | undefined => {
    const unasked = (devRows.all(ladderId, itemId) as unknown as EvidenceRow[]).filter((r) => !askedAbout.get(`${EVIDENCE_REF}${r.id}`));
    const answered = new Set((clearTickets.all(ladderId, itemId) as { ticket: string }[]).map((r) => r.ticket));
    return unasked.find((r) => !answered.has(r.ticket)) ?? unasked[0];
  };

  // 1. Why-questions on the developer's own code, for items still Not seen or Learning.
  for (const { loaded, statuses } of results) {
    for (const status of statuses.values()) {
      if (out.length >= max) break;
      if (usedItems.has(status.item_id) || (status.state !== "not_seen" && status.state !== "learning")) continue;
      // The same piece of evidence is asked about once; other or new evidence brings a new question.
      const row = nextEvidence(loaded.ladder_id, status.item_id);
      if (!row) continue;
      const about = aboutEvidence(row);
      const id = randomUUID();
      insert.run(id, "why", loaded.ladder_id, status.item_id, `${EVIDENCE_REF}${row.id}`, null, row.ticket);
      out.push({ question_id: id, kind: "why", item_id: status.item_id, ticket: row.ticket, about, opened: false });
      usedItems.add(status.item_id);
    }
  }

  // 2. Explain-back on decisions the AI made that name an item and were never explained.
  const decisions = db
    .prepare(
      `SELECT d.id, d.ladder_id, d.item_id, d.ticket_id, d.summary FROM decisions d
       WHERE d.item_id IS NOT NULL AND d.origin = 'ai'
         AND NOT EXISTS (SELECT 1 FROM explain_backs e WHERE e.decision_id = d.id)
         AND NOT EXISTS (SELECT 1 FROM pending_questions q WHERE q.decision_id = d.id)
       ORDER BY d.created_at, d.rowid`,
    )
    .all() as { id: string; ladder_id: string; item_id: string; ticket_id: string; summary: string }[];
  for (const d of decisions) {
    if (out.length >= max) break;
    if (usedItems.has(d.item_id) || !inLadder(d.ladder_id, d.item_id)) continue;
    const id = randomUUID();
    insert.run(id, "explain_back", d.ladder_id, d.item_id, null, d.id, d.ticket_id);
    out.push({ question_id: id, kind: "explain_back", item_id: d.item_id, ticket: d.ticket_id, about: d.summary, opened: false });
    usedItems.add(d.item_id);
  }
  return out;
}

export interface OpenQuestionInput {
  session_id: string;
  question_id?: string;
  decision_id?: string;
  item_id?: string;
  ladder_id?: string;
  text: string;
}

/** Opens one question for this session, just before the AI asks it. Any other open question is put aside. */
export function openQuestion(db: Db, input: OpenQuestionInput, now: Date = new Date()): QuestionView {
  if ((input.question_id === undefined) === (input.decision_id === undefined)) {
    throw new StoreError("Give exactly one of question_id or decision_id");
  }
  let id = input.question_id;
  if (input.decision_id !== undefined) {
    const d = db.prepare("SELECT id, ticket_id, ladder_id, item_id, summary FROM decisions WHERE id = ?").get(input.decision_id) as
      | { id: string; ticket_id: string; ladder_id: string | null; item_id: string | null; summary: string }
      | undefined;
    if (!d) throw new StoreError(`Decision '${input.decision_id}' does not exist`);
    const itemId = input.item_id ?? d.item_id;
    const ladderId = input.ladder_id ?? d.ladder_id;
    if (!itemId || !ladderId) throw new StoreError("This decision has no ladder item. Pass item_id with the ladder item it is about");
    id = randomUUID();
    db.prepare("INSERT INTO pending_questions (id, kind, ladder_id, item_id, decision_id, ticket) VALUES (?, 'explain_back', ?, ?, ?, ?)").run(
      id,
      ladderId,
      itemId,
      d.id,
      d.ticket_id,
    );
  }
  const row = db.prepare("SELECT * FROM pending_questions WHERE id = ?").get(id!) as unknown as QuestionRow | undefined;
  if (!row) throw new StoreError(`Question '${id}' does not exist`);
  if (row.answered_at !== null) throw new StoreError("This question was already answered");
  db.prepare("UPDATE pending_questions SET closed_reason = 'later', open_session = NULL WHERE open_session = ? AND answered_at IS NULL AND id != ?").run(input.session_id, row.id);
  db.prepare("UPDATE pending_questions SET question = ?, opened_at = ?, open_session = ?, closed_reason = NULL WHERE id = ?").run(
    input.text,
    now.toISOString(),
    input.session_id,
    row.id,
  );
  return view(db, { ...row, question: input.text, open_session: input.session_id });
}

/**
 * Called by the prompt hook with each message the developer sends. If a question is open in this session, the
 * message is saved as its answer, exactly as typed. `allowed` is the privacy check for the answer.
 */
export function captureAnswer(
  db: Db,
  sessionId: string,
  message: string,
  now: Date = new Date(),
  allowed: (text: string) => boolean = () => true,
): { captured: false } | { captured: true; question_id: string; closed: "answered" | "later" } {
  const row = db.prepare("SELECT * FROM pending_questions WHERE open_session = ? AND answered_at IS NULL AND closed_reason IS NULL").get(sessionId) as unknown as
    | QuestionRow
    | undefined;
  if (!row) return { captured: false };
  const openedAt = row.opened_at ? Date.parse(row.opened_at) : now.getTime();
  if (now.getTime() - openedAt > DEFAULT_THRESHOLDS.question_timeout_min * 60_000) {
    db.prepare("UPDATE pending_questions SET closed_reason = 'timeout', open_session = NULL WHERE id = ?").run(row.id);
    return { captured: false };
  }
  const text = message.trim();
  if (text.startsWith("/") || isClarification(text)) return { captured: false };
  if (isLaterReply(text)) {
    db.prepare("UPDATE pending_questions SET closed_reason = 'later', open_session = NULL WHERE id = ?").run(row.id);
    return { captured: true, question_id: row.id, closed: "later" };
  }
  const answer = allowed(text) ? text : HELD_BACK;
  db.prepare("UPDATE pending_questions SET answer = ?, answered_at = ?, closed_reason = 'answered', open_session = NULL WHERE id = ?").run(answer, now.toISOString(), row.id);
  return { captured: true, question_id: row.id, closed: "answered" };
}

/** Rates a captured answer, once. The trade-off flag needs a quote that is really in the answer. */
export function rateAnswer(
  db: Db,
  input: { question_id: string; rating: Rating; tradeoff_quote?: string },
): { rating: Rating; names_tradeoff: boolean; note?: string } {
  const row = db.prepare("SELECT * FROM pending_questions WHERE id = ?").get(input.question_id) as unknown as QuestionRow | undefined;
  if (!row) throw new StoreError(`Question '${input.question_id}' does not exist`);
  if (row.kind === "drill") throw new StoreError("This is a drill. Use score_drill for it");
  if (row.answered_at === null || row.answer === null) throw new StoreError("This question has no answer yet. Ask it and wait for the developer's reply");
  if (row.rating !== null) throw new StoreError("This answer was already rated");
  let namesTradeoff = false;
  let note: string | undefined;
  if (input.tradeoff_quote !== undefined) {
    namesTradeoff = quoteIn(row.answer, input.tradeoff_quote);
    if (!namesTradeoff) note = "The quote is not in the answer, so the trade-off flag was dropped.";
  }
  db.prepare("UPDATE pending_questions SET rating = ?, names_tradeoff = ?, tradeoff_quote = ?, rated_at = ? WHERE id = ?").run(
    input.rating,
    namesTradeoff ? 1 : 0,
    namesTradeoff ? input.tradeoff_quote! : null,
    new Date().toISOString(),
    row.id,
  );
  if (row.kind === "explain_back" && row.decision_id !== null) {
    db.prepare("INSERT INTO explain_backs (id, decision_id, question, answer, rating, question_id, item_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      randomUUID(),
      row.decision_id,
      row.question ?? "",
      row.answer,
      input.rating,
      row.id,
      row.item_id,
    );
  }
  return { rating: input.rating, names_tradeoff: namesTradeoff, ...(note ? { note } : {}) };
}
