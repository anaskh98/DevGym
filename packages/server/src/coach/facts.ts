// Loads the stored facts about one ladder item, in the shape the state engine reads.
import type { Db } from "../db/connection.js";
import type { AnswerFact, DrillFact, EvidenceFact } from "./state.js";

/** SQLite's datetime('now') text ("2026-11-18 10:00:00", UTC) as ISO 8601. ISO text is kept as it is. */
export function toIso(value: string): string {
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

interface EvidenceRow {
  id: string;
  kind: EvidenceFact["kind"];
  polarity: EvidenceFact["polarity"];
  author: EvidenceFact["author"];
  decided_by: EvidenceFact["decided_by"];
  history: number;
  regresses: number;
  signal_id: string | null;
  file_path: string | null;
  symbol: string | null;
  ticket: string;
  at: string;
  fixed_at: string | null;
  fixed_ticket: string | null;
  disagreed_at: string | null;
}

export function factsForItem(db: Db, ladderId: string, itemId: string): { evidence: EvidenceFact[]; answers: AnswerFact[]; drills: DrillFact[] } {
  const evidence = (db.prepare("SELECT * FROM skill_evidence WHERE ladder_id = ? AND item_id = ?").all(ladderId, itemId) as unknown as EvidenceRow[]).map(
    (r): EvidenceFact => ({
      id: r.id,
      kind: r.kind,
      polarity: r.polarity,
      author: r.author,
      decided_by: r.decided_by,
      history: r.history === 1,
      regresses: r.regresses === 1,
      signal_id: r.signal_id,
      file: r.file_path,
      symbol: r.symbol,
      ticket: r.ticket,
      at: toIso(r.at),
      fixed_at: r.fixed_at === null ? null : toIso(r.fixed_at),
      fixed_ticket: r.fixed_ticket,
      disagreed: r.disagreed_at !== null,
    }),
  );
  const answers = (
    db
      .prepare("SELECT id, rating, ticket, names_tradeoff, answered_at FROM pending_questions WHERE ladder_id = ? AND item_id = ? AND rating IS NOT NULL AND answered_at IS NOT NULL")
      .all(ladderId, itemId) as { id: string; rating: AnswerFact["rating"]; ticket: string; names_tradeoff: number; answered_at: string }[]
  ).map((r): AnswerFact => ({ id: r.id, rating: r.rating, ticket: r.ticket, names_tradeoff: r.names_tradeoff === 1, at: toIso(r.answered_at) }));
  const drills = (
    db.prepare("SELECT id, drill_id, passed, void, created_at FROM drill_attempts WHERE ladder_id = ? AND item_id = ?").all(ladderId, itemId) as {
      id: string;
      drill_id: string;
      passed: number;
      void: number;
      created_at: string;
    }[]
  ).map((r): DrillFact => ({ id: r.id, drill_id: r.drill_id, passed: r.passed === 1, void: r.void === 1, at: toIso(r.created_at) }));
  return { evidence, answers, drills };
}
