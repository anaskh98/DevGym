import { randomUUID } from "node:crypto";
import { transaction, type Db } from "./db/connection.js";
import { StoreError } from "./errors.js";
import type {
  LogDecisionInput,
  RecordExplainBackInput,
  SaveAssumptionsInput,
  SaveGrowthPlanInput,
  SaveObservationInput,
  StartTrailInput,
} from "./mcp/schemas.js";
import { pathKey, tidyPath } from "./paths.js";
import type { PrivacyGuard } from "./privacy/guard.js";
import type { TicketAdapter } from "./tickets/adapter.js";

export { StoreError };

export interface Ticket {
  id: string;
  title: string;
  body: string;
  source: string;
}

export function localDeveloperId(): string {
  return process.env.FTC_DEVELOPER_ID ?? "local";
}

function exists(db: Db, table: string, id: string): boolean {
  return db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id) !== undefined;
}

function requireRow(db: Db, table: string, label: string, id: string): void {
  if (!exists(db, table, id)) throw new StoreError(`${label} '${id}' does not exist`);
}

export function getTicket(db: Db, ticketId: string): Ticket {
  const row = db.prepare("SELECT id, title, body, source FROM tickets WHERE id = ?").get(ticketId);
  if (!row) throw new StoreError(`Ticket '${ticketId}' does not exist`);
  return { ...row } as unknown as Ticket;
}

/** Saves the local copy of a ticket, so other records can link to it. */
export function upsertTicket(db: Db, ticket: Ticket): void {
  db.prepare(`
    INSERT INTO tickets (id, title, body, source) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, source = excluded.source
  `).run(ticket.id, ticket.title, ticket.body, ticket.source);
}

/**
 * Makes sure the ticket is in the local store, reading it from the ticket source first.
 * If the source no longer has it, a copy saved earlier still counts.
 */
export async function ensureTicket(
  db: Db,
  adapter: TicketAdapter,
  ticketId: string,
  guard?: PrivacyGuard,
): Promise<Ticket> {
  const fresh = await adapter.getTicket(ticketId);
  if (fresh) guard?.checkTicket(fresh);
  if (fresh) upsertTicket(db, { ...fresh, source: adapter.source });
  return getTicket(db, ticketId);
}

/** Replaces the ticket's assumption list, so running Fork again does not pile up duplicates. */
export function saveAssumptions(db: Db, input: SaveAssumptionsInput): { assumption_ids: string[] } {
  requireRow(db, "tickets", "Ticket", input.ticket_id);
  const insert = db.prepare(
    "INSERT INTO assumptions (id, ticket_id, text, status, answer) VALUES (?, ?, ?, ?, ?)",
  );
  const ids: string[] = [];
  transaction(db, () => {
    db.prepare("DELETE FROM assumptions WHERE ticket_id = ?").run(input.ticket_id);
    for (const a of input.assumptions) {
      const id = randomUUID();
      insert.run(id, input.ticket_id, a.text, a.status, a.answer ?? null);
      ids.push(id);
    }
  });
  return { assumption_ids: ids };
}

/** `root` is the repo folder. File paths are stored relative to it, so they match the hook's records. */
export function logDecision(
  db: Db,
  input: LogDecisionInput,
  root: string = process.cwd(),
): { decision_id: string; pointer_id: string | null } {
  requireRow(db, "tickets", "Ticket", input.ticket_id);
  const decisionId = randomUUID();
  let pointerId: string | null = null;
  const relatedFiles = input.related_files.map((f) => tidyPath(f, root));
  transaction(db, () => {
    const p = input.pointer;
    if (p) {
      pointerId = randomUUID();
      db.prepare(
        "INSERT INTO pointers (id, repo, pr_number, file_path, symbol, commit_sha, line_hint) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(pointerId, p.repo, p.pr_number ?? null, tidyPath(p.file_path, root), p.symbol ?? null, p.commit ?? null, p.line_hint ?? null);
    }
    db.prepare(
      "INSERT INTO decisions (id, ticket_id, session_id, summary, alternatives, origin, pointer_id, related_files) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      decisionId,
      input.ticket_id,
      input.session_id,
      input.summary,
      JSON.stringify(input.alternatives),
      input.origin,
      pointerId,
      JSON.stringify(relatedFiles),
    );
  });
  return { decision_id: decisionId, pointer_id: pointerId };
}

export interface Assumption {
  id: string;
  text: string;
  status: string;
  answer: string | null;
}

/** Marks a session as tracked. From now on the edit hook records its file edits. Safe to call again. */
export function startTrail(
  db: Db,
  input: StartTrailInput,
): { session_id: string; ticket: Ticket; assumptions: Assumption[] } {
  const ticket = getTicket(db, input.ticket_id);
  db.prepare(
    "INSERT INTO trail_sessions (session_id, ticket_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET ticket_id = excluded.ticket_id",
  ).run(input.session_id, input.ticket_id);
  const assumptions = db
    .prepare("SELECT id, text, status, answer FROM assumptions WHERE ticket_id = ? ORDER BY rowid")
    .all(input.ticket_id)
    .map((r) => ({ ...r })) as unknown as Assumption[];
  return { session_id: input.session_id, ticket, assumptions };
}

/**
 * Called by the edit hook. Records the edit only when the session is tracked.
 * `first` is true the first time this file is edited in the session.
 */
export function recordFileEdit(db: Db, sessionId: string, filePath: string): { tracked: boolean; first: boolean } {
  if (!db.prepare("SELECT 1 FROM trail_sessions WHERE session_id = ?").get(sessionId)) {
    return { tracked: false, first: false };
  }
  const row = db
    .prepare(
      `INSERT INTO file_edits (session_id, file_path) VALUES (?, ?)
       ON CONFLICT(session_id, file_path) DO UPDATE SET edit_count = edit_count + 1, last_edited_at = datetime('now')
       RETURNING edit_count`,
    )
    .get(sessionId, filePath) as { edit_count: number };
  return { tracked: true, first: row.edit_count === 1 };
}

export interface TrailDecision {
  id: string;
  summary: string;
  origin: string;
  alternatives: string[];
  file_path: string | null;
  symbol: string | null;
  related_files: string[];
}

export interface Trail {
  session_id: string;
  tracking: boolean;
  ticket_id: string | null;
  decisions: TrailDecision[];
  edited_files: { file_path: string; edit_count: number; explained: boolean }[];
  /** Edited files that no decision points at. */
  unexplained_files: string[];
}

export function getTrail(db: Db, sessionId: string): Trail {
  const session = db.prepare("SELECT ticket_id FROM trail_sessions WHERE session_id = ?").get(sessionId) as
    | { ticket_id: string }
    | undefined;
  const decisions = db
    .prepare(
      `SELECT d.id, d.summary, d.origin, d.alternatives, d.related_files, p.file_path, p.symbol
       FROM decisions d LEFT JOIN pointers p ON p.id = d.pointer_id
       WHERE d.session_id = ? ORDER BY d.rowid`,
    )
    .all(sessionId)
    .map((r) => {
      const row = r as Record<string, string | null>;
      return {
        id: row.id as string,
        summary: row.summary as string,
        origin: row.origin as string,
        alternatives: JSON.parse(row.alternatives as string) as string[],
        file_path: row.file_path ?? null,
        symbol: row.symbol ?? null,
        related_files: JSON.parse(row.related_files as string) as string[],
      };
    });
  const explained = new Set<string>();
  for (const d of decisions) {
    if (d.file_path) explained.add(pathKey(d.file_path));
    for (const f of d.related_files) explained.add(pathKey(f));
  }
  const editedFiles = (
    db
      .prepare("SELECT file_path, edit_count FROM file_edits WHERE session_id = ? ORDER BY first_edited_at, rowid")
      .all(sessionId) as { file_path: string; edit_count: number }[]
  ).map((f) => ({ file_path: f.file_path, edit_count: f.edit_count, explained: explained.has(pathKey(f.file_path)) }));
  return {
    session_id: sessionId,
    tracking: session !== undefined,
    ticket_id: session?.ticket_id ?? null,
    decisions,
    edited_files: editedFiles,
    unexplained_files: editedFiles.filter((f) => !f.explained).map((f) => f.file_path),
  };
}

export interface TicketDecision extends TrailDecision {
  session_id: string;
  /** How many explain-backs this decision already has. */
  explain_back_count: number;
}

/** Every decision logged for a ticket, across sessions, oldest first. */
export function listDecisions(db: Db, ticketId: string): { ticket_id: string; decisions: TicketDecision[] } {
  requireRow(db, "tickets", "Ticket", ticketId);
  const decisions = db
    .prepare(
      `SELECT d.id, d.session_id, d.summary, d.origin, d.alternatives, d.related_files, p.file_path, p.symbol,
              (SELECT count(*) FROM explain_backs e WHERE e.decision_id = d.id) AS explain_back_count
       FROM decisions d LEFT JOIN pointers p ON p.id = d.pointer_id
       WHERE d.ticket_id = ? ORDER BY d.rowid`,
    )
    .all(ticketId)
    .map((r) => {
      const row = r as Record<string, string | number | null>;
      return {
        id: row.id as string,
        session_id: row.session_id as string,
        summary: row.summary as string,
        origin: row.origin as string,
        alternatives: JSON.parse(row.alternatives as string) as string[],
        file_path: (row.file_path as string | null) ?? null,
        symbol: (row.symbol as string | null) ?? null,
        related_files: JSON.parse(row.related_files as string) as string[],
        explain_back_count: Number(row.explain_back_count),
      };
    });
  return { ticket_id: ticketId, decisions };
}

export function recordExplainBack(db: Db, input: RecordExplainBackInput): { explain_back_id: string } {
  requireRow(db, "decisions", "Decision", input.decision_id);
  const id = randomUUID();
  db.prepare("INSERT INTO explain_backs (id, decision_id, question, answer, rating) VALUES (?, ?, ?, ?, ?)").run(
    id,
    input.decision_id,
    input.question,
    input.answer,
    input.rating,
  );
  return { explain_back_id: id };
}

export function saveObservation(db: Db, input: SaveObservationInput): { observation_id: string } {
  for (const evidenceId of input.evidence_ids) {
    if (!exists(db, "decisions", evidenceId) && !exists(db, "explain_backs", evidenceId)) {
      throw new StoreError(`Evidence '${evidenceId}' is not a known decision or explain-back`);
    }
  }
  const id = randomUUID();
  db.prepare("INSERT INTO observations (id, developer_id, skill_tag, summary, evidence_ids) VALUES (?, ?, ?, ?, ?)").run(
    id,
    input.developer_id ?? localDeveloperId(),
    input.skill_tag,
    input.summary,
    JSON.stringify(input.evidence_ids),
  );
  return { observation_id: id };
}

export interface ObservationEvidence {
  id: string;
  kind: "decision" | "explain_back" | "missing";
  ticket_id?: string;
  /** For a decision: who made the choice. */
  origin?: string;
  /** For an explain-back: how clear the developer's answer was. */
  rating?: string;
}

export interface ObservationView {
  id: string;
  skill_tag: string;
  summary: string;
  created_at: string;
  evidence: ObservationEvidence[];
}

/** A developer's observations, oldest first, with what each piece of evidence is. */
export function listObservations(
  db: Db,
  developerId: string = localDeveloperId(),
): { developer_id: string; observations: ObservationView[] } {
  const decision = db.prepare("SELECT ticket_id, origin FROM decisions WHERE id = ?");
  const explainBack = db.prepare(
    "SELECT e.rating, d.ticket_id FROM explain_backs e JOIN decisions d ON d.id = e.decision_id WHERE e.id = ?",
  );
  const describe = (id: string): ObservationEvidence => {
    const d = decision.get(id) as { ticket_id: string; origin: string } | undefined;
    if (d) return { id, kind: "decision", ticket_id: d.ticket_id, origin: d.origin };
    const e = explainBack.get(id) as { ticket_id: string; rating: string } | undefined;
    if (e) return { id, kind: "explain_back", ticket_id: e.ticket_id, rating: e.rating };
    return { id, kind: "missing" }; // The evidence was deleted after the observation was saved.
  };
  const observations = (
    db
      .prepare("SELECT id, skill_tag, summary, evidence_ids, created_at FROM observations WHERE developer_id = ? ORDER BY rowid")
      .all(developerId) as { id: string; skill_tag: string; summary: string; evidence_ids: string; created_at: string }[]
  ).map((o) => ({
    id: o.id,
    skill_tag: o.skill_tag,
    summary: o.summary,
    created_at: o.created_at,
    evidence: (JSON.parse(o.evidence_ids) as string[]).map(describe),
  }));
  return { developer_id: developerId, observations };
}

export interface SavedFocusArea {
  id: string;
  claim: string;
  evidence_ids: string[];
  tentative: boolean;
  exercise: string;
}

/**
 * The server decides "tentative", not the model: a claim resting on one observation is tentative.
 */
export function saveGrowthPlan(
  db: Db,
  input: SaveGrowthPlanInput,
): { growth_plan_id: string; focus_areas: SavedFocusArea[] } {
  const developerId = input.developer_id ?? localDeveloperId();
  const ownsObservation = db.prepare("SELECT 1 FROM observations WHERE id = ? AND developer_id = ?");
  const focusAreas = input.focus_areas.map((area) => {
    const evidence = [...new Set(area.evidence_ids)];
    for (const evidenceId of evidence) {
      if (!ownsObservation.get(evidenceId, developerId)) {
        throw new StoreError(`Evidence '${evidenceId}' is not an observation of developer '${developerId}'`);
      }
    }
    // Each focus area gets its own id, so a note in the web app can point at one claim.
    return { id: randomUUID(), claim: area.claim, evidence_ids: evidence, tentative: evidence.length < 2, exercise: area.exercise };
  });
  const id = randomUUID();
  db.prepare("INSERT INTO growth_plans (id, developer_id, focus_areas) VALUES (?, ?, ?)").run(
    id,
    developerId,
    JSON.stringify(focusAreas),
  );
  return { growth_plan_id: id, focus_areas: focusAreas };
}
