// Queries behind the REST API. The web app reads everything through these shapes.
import { randomUUID } from "node:crypto";
import { transaction, type Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { getTrail, listObservations, localDeveloperId, type ObservationView } from "../store.js";

type Row = Record<string, string | number | null>;
const rows = (db: Db, sql: string, ...params: (string | number)[]): Row[] =>
  db.prepare(sql).all(...params).map((r) => ({ ...r }) as Row);

export interface AnnotationView {
  id: string;
  target_id: string;
  note: string;
  disagrees: boolean;
  created_at: string;
}

export interface PointerView {
  id: string;
  repo: string;
  pr_number: number | null;
  file_path: string;
  symbol: string | null;
  commit: string | null;
  line_hint: number | null;
  /** Link to the file on GitHub, pinned to the commit. Null until the pointer has a commit. */
  url: string | null;
}

export interface DecisionView {
  id: string;
  ticket_id: string;
  session_id: string;
  summary: string;
  alternatives: string[];
  origin: string;
  related_files: string[];
  created_at: string;
  pointer: PointerView | null;
  explain_backs: { id: string; question: string; answer: string; rating: string; created_at: string }[];
  annotations: AnnotationView[];
}

function annotationsFor(db: Db, targetId: string): AnnotationView[] {
  return rows(db, "SELECT id, target_id, note, disagrees, created_at FROM annotations WHERE target_id = ? ORDER BY rowid", targetId).map(
    (a) => ({ ...a, disagrees: a.disagrees === 1 }) as unknown as AnnotationView,
  );
}

function pointerUrl(p: Row): string | null {
  const repo = String(p.repo);
  if (!p.commit_sha || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const path = String(p.file_path).split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${repo}/blob/${p.commit_sha}/${path}${p.line_hint ? `#L${p.line_hint}` : ""}`;
}

export function listTickets(db: Db) {
  return rows(
    db,
    `SELECT t.id, t.title, t.source, t.created_at,
            (SELECT count(*) FROM assumptions a WHERE a.ticket_id = t.id) AS assumption_count,
            (SELECT count(*) FROM decisions d WHERE d.ticket_id = t.id) AS decision_count
     FROM tickets t ORDER BY t.rowid`,
  );
}

export function ticketDecisions(db: Db, ticketId: string): DecisionView[] {
  return rows(
    db,
    `SELECT d.id, d.ticket_id, d.session_id, d.summary, d.alternatives, d.origin, d.related_files, d.created_at,
            p.id AS p_id, p.repo, p.pr_number, p.file_path, p.symbol, p.commit_sha, p.line_hint
     FROM decisions d LEFT JOIN pointers p ON p.id = d.pointer_id
     WHERE d.ticket_id = ? ORDER BY d.rowid`,
    ticketId,
  ).map((d) => ({
    id: d.id as string,
    ticket_id: d.ticket_id as string,
    session_id: d.session_id as string,
    summary: d.summary as string,
    alternatives: JSON.parse(d.alternatives as string) as string[],
    origin: d.origin as string,
    related_files: JSON.parse(d.related_files as string) as string[],
    created_at: d.created_at as string,
    pointer: d.p_id
      ? {
          id: d.p_id as string,
          repo: d.repo as string,
          pr_number: d.pr_number as number | null,
          file_path: d.file_path as string,
          symbol: d.symbol as string | null,
          commit: d.commit_sha as string | null,
          line_hint: d.line_hint as number | null,
          url: pointerUrl(d),
        }
      : null,
    explain_backs: rows(
      db,
      "SELECT id, question, answer, rating, created_at FROM explain_backs WHERE decision_id = ? ORDER BY rowid",
      d.id as string,
    ) as unknown as DecisionView["explain_backs"],
    annotations: annotationsFor(db, d.id as string),
  }));
}

export function ticketDetail(db: Db, ticketId: string) {
  const ticket = rows(db, "SELECT id, title, body, source, created_at FROM tickets WHERE id = ?", ticketId)[0];
  if (!ticket) return null;
  const assumptions = rows(
    db,
    "SELECT id, text, status, answer, created_at FROM assumptions WHERE ticket_id = ? ORDER BY rowid",
    ticketId,
  );
  const sessions = rows(db, "SELECT session_id, started_at FROM trail_sessions WHERE ticket_id = ? ORDER BY rowid", ticketId).map(
    (s) => {
      const trail = getTrail(db, s.session_id as string);
      return { ...s, edited_files: trail.edited_files, unexplained_files: trail.unexplained_files };
    },
  );
  return { ticket, assumptions, decisions: ticketDecisions(db, ticketId), sessions };
}

/** The newest growth plan, with each claim's evidence and notes filled in. Null when there is none. */
export function latestGrowthPlan(db: Db, developerId: string = localDeveloperId()) {
  const plan = rows(
    db,
    "SELECT id, developer_id, focus_areas, created_at FROM growth_plans WHERE developer_id = ? ORDER BY rowid DESC LIMIT 1",
    developerId,
  )[0];
  if (!plan) return null;
  const observations = new Map<string, ObservationView>(
    listObservations(db, developerId).observations.map((o) => [o.id, o]),
  );
  const areas = JSON.parse(plan.focus_areas as string) as {
    id?: string;
    claim: string;
    evidence_ids: string[];
    tentative: boolean;
    exercise: string;
  }[];
  return {
    id: plan.id,
    developer_id: plan.developer_id,
    created_at: plan.created_at,
    focus_areas: areas.map((area, index) => {
      // Plans saved before claims had ids get a stable one made from the plan id and position.
      const id = area.id ?? `${plan.id}:${index}`;
      return {
        id,
        claim: area.claim,
        tentative: area.tentative,
        exercise: area.exercise,
        evidence: area.evidence_ids.map((e) => observations.get(e)).filter((o) => o !== undefined),
        annotations: annotationsFor(db, id),
      };
    }),
  };
}

function targetExists(db: Db, targetId: string): boolean {
  for (const table of ["decisions", "assumptions", "explain_backs", "observations", "growth_plans", "tickets"]) {
    if (db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(targetId)) return true;
  }
  // A single claim inside a growth plan: by its own id, or "planId:position" for plans saved before claims had ids.
  return (
    db
      .prepare(
        `SELECT 1 FROM growth_plans g, json_each(g.focus_areas) fa
         WHERE json_extract(fa.value, '$.id') = ?
            OR (json_extract(fa.value, '$.id') IS NULL AND g.id || ':' || fa.key = ?)`,
      )
      .get(targetId, targetId) !== undefined
  );
}

export function addAnnotation(db: Db, input: { target_id: string; note: string; disagrees: boolean }): AnnotationView {
  if (!targetExists(db, input.target_id)) throw new StoreError(`Nothing with id '${input.target_id}' exists to add a note to`);
  const id = randomUUID();
  db.prepare("INSERT INTO annotations (id, target_id, note, disagrees) VALUES (?, ?, ?, ?)").run(
    id,
    input.target_id,
    input.note,
    input.disagrees ? 1 : 0,
  );
  return annotationsFor(db, input.target_id).find((a) => a.id === id) as AnnotationView;
}

export function deleteAnnotation(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM annotations WHERE id = ?").run(id).changes > 0;
}

// Children before parents, so deletes never trip a foreign key.
const DATA_TABLES = [
  "annotations",
  "growth_plans",
  "observations",
  "explain_backs",
  "file_edits",
  "trail_sessions",
  "decisions",
  "pointers",
  "assumptions",
  "tickets",
] as const;
const JSON_COLUMNS = new Set(["alternatives", "related_files", "evidence_ids", "focus_areas"]);

export function countAll(db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const table of DATA_TABLES) counts[table] = Number(rows(db, `SELECT count(*) AS n FROM ${table}`)[0]?.n ?? 0);
  return counts;
}

/** Everything stored about the developer, as plain JSON. This is the whole profile. */
export function exportAll(db: Db) {
  const data: Record<string, unknown[]> = {};
  for (const table of [...DATA_TABLES].reverse()) {
    data[table] = rows(db, `SELECT * FROM ${table} ORDER BY rowid`).map((row) => {
      for (const column of Object.keys(row)) {
        if (JSON_COLUMNS.has(column)) row[column] = JSON.parse(row[column] as string);
      }
      return row;
    });
  }
  return { exported_at: new Date().toISOString(), counts: countAll(db), data };
}

/** Deletes every stored row. The tables stay. Returns how many rows each table lost. */
export function deleteAll(db: Db): Record<string, number> {
  const deleted = countAll(db);
  transaction(db, () => {
    for (const table of DATA_TABLES) db.exec(`DELETE FROM ${table}`);
  });
  return deleted;
}
