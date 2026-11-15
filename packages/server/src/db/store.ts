/**
 * The only place that writes to SQLite. Every write method calls the privacy
 * guard first, so a new write path cannot skip it by accident.
 */
import { randomBytes } from "node:crypto";
import {
  ID_PREFIX,
  type Assumption,
  type AssumptionInput,
  type Decision,
  type DecisionOrigin,
  type ExplainBack,
  type ExplainBackRating,
  type FocusArea,
  type FocusAreaInput,
  type ForkRun,
  type GrowthPlan,
  type Observation,
  type Pointer,
  type PointerInput,
  type Ticket,
  type TicketSummary,
} from "@ftc/shared";
import { InvalidReferenceError, NotFoundError } from "../errors";
import { assertAllowed, type PrivacyGuard } from "../privacy/guard";
import { transaction, type Db } from "./connection";

type Row = Record<string, unknown>;

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

const str = (value: unknown): string => String(value);
const strOrNull = (value: unknown): string | null => (value == null ? null : String(value));
const intOrNull = (value: unknown): number | null => (value == null ? null : Number(value));
const list = (value: unknown): string[] => JSON.parse(String(value)) as string[];

function toTicket(row: Row): Ticket {
  return {
    id: str(row.id),
    title: str(row.title),
    body: str(row.body),
    source: str(row.source),
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

function toAssumption(row: Row): Assumption {
  return {
    id: str(row.id),
    ticket_id: str(row.ticket_id),
    run_id: str(row.run_id),
    position: Number(row.position),
    text: str(row.text),
    readings: list(row.readings),
    status: str(row.status) as Assumption["status"],
    answer: str(row.answer),
    created_at: str(row.created_at),
  };
}

function toPointer(row: Row): Pointer {
  return {
    id: str(row.id),
    repo: strOrNull(row.repo),
    pr_number: intOrNull(row.pr_number),
    file_path: str(row.file_path),
    symbol: strOrNull(row.symbol),
    commit: strOrNull(row.commit_sha),
    line_hint: intOrNull(row.line_hint),
    created_at: str(row.created_at),
  };
}

function toDecision(row: Row): Decision {
  return {
    id: str(row.id),
    ticket_id: str(row.ticket_id),
    session_id: str(row.session_id),
    summary: str(row.summary),
    alternatives: list(row.alternatives),
    origin: str(row.origin) as DecisionOrigin,
    pointer_id: strOrNull(row.pointer_id),
    created_at: str(row.created_at),
  };
}

export interface StoreOptions {
  guard: PrivacyGuard;
  /** Injectable clock, for tests. */
  now?: () => Date;
}

export class Store {
  private readonly guard: PrivacyGuard;
  private readonly now: () => Date;

  constructor(
    private readonly db: Db,
    options: StoreOptions,
  ) {
    this.guard = options.guard;
    this.now = options.now ?? (() => new Date());
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  // -- Tickets --------------------------------------------------------------

  upsertTicket(input: { id: string; title: string; body: string; source: string }): Ticket {
    assertAllowed(this.guard, {
      kind: "ticket",
      fields: { title: input.title, body: input.body },
    });
    const at = this.timestamp();
    this.db
      .prepare(
        `INSERT INTO tickets (id, title, body, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           body = excluded.body,
           source = excluded.source,
           updated_at = excluded.updated_at`,
      )
      .run(input.id, input.title, input.body, input.source, at, at);
    return this.requireTicket(input.id);
  }

  getTicket(id: string): Ticket | null {
    const row = this.db.prepare("SELECT * FROM tickets WHERE id = ?").get(id);
    return row ? toTicket(row) : null;
  }

  requireTicket(id: string): Ticket {
    const ticket = this.getTicket(id);
    if (!ticket) {
      throw new NotFoundError(`Ticket "${id}" is not in the local store. Call get_ticket first.`);
    }
    return ticket;
  }

  listTickets(): TicketSummary[] {
    return this.db
      .prepare(
        `SELECT t.id, t.title, t.source, t.updated_at,
                (SELECT COUNT(DISTINCT a.run_id) FROM assumptions a WHERE a.ticket_id = t.id) AS fork_runs
         FROM tickets t
         ORDER BY t.id`,
      )
      .all()
      .map((row) => ({
        id: str(row.id),
        title: str(row.title),
        source: str(row.source),
        fork_runs: Number(row.fork_runs),
        updated_at: str(row.updated_at),
      }));
  }

  // -- Fork: assumptions ----------------------------------------------------

  saveAssumptions(ticketId: string, inputs: AssumptionInput[]): ForkRun {
    this.requireTicket(ticketId);
    for (const input of inputs) {
      assertAllowed(this.guard, {
        kind: "assumption",
        fields: { text: input.text, readings: input.readings, answer: input.answer },
      });
    }

    const runId = newId(ID_PREFIX.forkRun);
    const at = this.timestamp();
    const insert = this.db.prepare(
      `INSERT INTO assumptions (id, ticket_id, run_id, position, text, readings, status, answer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    transaction(this.db, () => {
      inputs.forEach((input, position) => {
        insert.run(
          newId(ID_PREFIX.assumption),
          ticketId,
          runId,
          position,
          input.text,
          JSON.stringify(input.readings),
          input.status,
          input.answer,
          at,
        );
      });
    });

    return { run_id: runId, created_at: at, assumptions: this.listAssumptions(ticketId, runId) };
  }

  private listAssumptions(ticketId: string, runId: string): Assumption[] {
    return this.db
      .prepare("SELECT * FROM assumptions WHERE ticket_id = ? AND run_id = ? ORDER BY position")
      .all(ticketId, runId)
      .map(toAssumption);
  }

  /** The /fork runs for a ticket, newest first. */
  listForkRuns(ticketId: string): ForkRun[] {
    const runs = new Map<string, ForkRun>();
    const rows = this.db
      .prepare(
        "SELECT * FROM assumptions WHERE ticket_id = ? ORDER BY created_at DESC, rowid DESC",
      )
      .all(ticketId)
      .map(toAssumption);
    for (const assumption of rows) {
      let run = runs.get(assumption.run_id);
      if (!run) {
        run = { run_id: assumption.run_id, created_at: assumption.created_at, assumptions: [] };
        runs.set(assumption.run_id, run);
      }
      run.assumptions.push(assumption);
    }
    for (const run of runs.values()) {
      run.assumptions.sort((a, b) => a.position - b.position);
    }
    return [...runs.values()];
  }

  // -- Paper Trail: decisions and pointers ----------------------------------

  logDecision(input: {
    ticket_id: string;
    session_id: string;
    summary: string;
    alternatives: string[];
    origin: DecisionOrigin;
    pointer?: PointerInput;
  }): { decision: Decision; pointer: Pointer | null } {
    this.requireTicket(input.ticket_id);
    assertAllowed(this.guard, {
      kind: "decision",
      fields: { summary: input.summary, alternatives: input.alternatives },
    });
    if (input.pointer) {
      assertAllowed(this.guard, {
        kind: "pointer",
        fields: { file_path: input.pointer.file_path, symbol: input.pointer.symbol },
      });
    }

    const at = this.timestamp();
    const decisionId = newId(ID_PREFIX.decision);
    const pointerId = input.pointer ? newId(ID_PREFIX.pointer) : null;

    transaction(this.db, () => {
      if (input.pointer && pointerId) {
        this.db
          .prepare(
            `INSERT INTO pointers (id, repo, pr_number, file_path, symbol, commit_sha, line_hint, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            pointerId,
            input.pointer.repo ?? null,
            input.pointer.pr_number ?? null,
            input.pointer.file_path,
            input.pointer.symbol ?? null,
            input.pointer.commit ?? null,
            input.pointer.line_hint ?? null,
            at,
          );
      }
      this.db
        .prepare(
          `INSERT INTO decisions (id, ticket_id, session_id, summary, alternatives, origin, pointer_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          decisionId,
          input.ticket_id,
          input.session_id,
          input.summary,
          JSON.stringify(input.alternatives),
          input.origin,
          pointerId,
          at,
        );
    });

    return {
      decision: this.requireDecision(decisionId),
      pointer: pointerId ? this.getPointer(pointerId) : null,
    };
  }

  getDecision(id: string): Decision | null {
    const row = this.db.prepare("SELECT * FROM decisions WHERE id = ?").get(id);
    return row ? toDecision(row) : null;
  }

  private requireDecision(id: string): Decision {
    const decision = this.getDecision(id);
    if (!decision) throw new NotFoundError(`Decision "${id}" does not exist.`);
    return decision;
  }

  getPointer(id: string): Pointer | null {
    const row = this.db.prepare("SELECT * FROM pointers WHERE id = ?").get(id);
    return row ? toPointer(row) : null;
  }

  // -- Explain-back ---------------------------------------------------------

  recordExplainBack(input: {
    decision_id: string;
    question: string;
    answer: string;
    rating: ExplainBackRating;
  }): ExplainBack {
    this.requireDecision(input.decision_id);
    assertAllowed(this.guard, {
      kind: "explain_back",
      fields: { question: input.question, answer: input.answer },
    });
    const record: ExplainBack = {
      id: newId(ID_PREFIX.explainBack),
      decision_id: input.decision_id,
      question: input.question,
      answer: input.answer,
      rating: input.rating,
      created_at: this.timestamp(),
    };
    this.db
      .prepare(
        `INSERT INTO explain_backs (id, decision_id, question, answer, rating, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.decision_id,
        record.question,
        record.answer,
        record.rating,
        record.created_at,
      );
    return record;
  }

  // -- Observations ---------------------------------------------------------

  saveObservation(input: {
    developer_id: string;
    skill_tag: string;
    summary: string;
    evidence_ids: string[];
  }): Observation {
    const missing = input.evidence_ids.filter((id) => !this.isEvidenceForObservation(id));
    if (missing.length > 0) {
      throw new InvalidReferenceError(
        `Evidence must be existing decision or explain-back ids. Not found: ${missing.join(", ")}`,
      );
    }
    assertAllowed(this.guard, {
      kind: "observation",
      fields: { skill_tag: input.skill_tag, summary: input.summary },
    });
    const record: Observation = {
      id: newId(ID_PREFIX.observation),
      developer_id: input.developer_id,
      skill_tag: input.skill_tag,
      summary: input.summary,
      evidence_ids: [...new Set(input.evidence_ids)],
      created_at: this.timestamp(),
    };
    this.db
      .prepare(
        `INSERT INTO observations (id, developer_id, skill_tag, summary, evidence_ids, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.developer_id,
        record.skill_tag,
        record.summary,
        JSON.stringify(record.evidence_ids),
        record.created_at,
      );
    return record;
  }

  private isEvidenceForObservation(id: string): boolean {
    return Boolean(
      this.db.prepare("SELECT 1 FROM decisions WHERE id = ?").get(id) ??
        this.db.prepare("SELECT 1 FROM explain_backs WHERE id = ?").get(id),
    );
  }

  // -- Coach: growth plans --------------------------------------------------

  /**
   * Claims without evidence are rejected, and a claim that rests on a single
   * observation is marked tentative. The server decides this, not the model.
   */
  saveGrowthPlan(input: { developer_id: string; focus_areas: FocusAreaInput[] }): GrowthPlan {
    const focusAreas: FocusArea[] = input.focus_areas.map((area) => {
      const evidence = [...new Set(area.evidence_ids)];
      if (evidence.length === 0) {
        throw new InvalidReferenceError(`Claim has no evidence: "${area.claim}"`);
      }
      const missing = evidence.filter(
        (id) =>
          !this.db
            .prepare("SELECT 1 FROM observations WHERE id = ? AND developer_id = ?")
            .get(id, input.developer_id),
      );
      if (missing.length > 0) {
        throw new InvalidReferenceError(
          `Evidence must be this developer's observation ids. Not found: ${missing.join(", ")}`,
        );
      }
      return {
        claim: area.claim,
        evidence_ids: evidence,
        tentative: evidence.length === 1,
        exercise: area.exercise,
      };
    });

    for (const area of focusAreas) {
      assertAllowed(this.guard, {
        kind: "growth_plan",
        fields: { claim: area.claim, exercise: area.exercise },
      });
    }

    const record: GrowthPlan = {
      id: newId(ID_PREFIX.growthPlan),
      developer_id: input.developer_id,
      focus_areas: focusAreas,
      created_at: this.timestamp(),
    };
    this.db
      .prepare(
        "INSERT INTO growth_plans (id, developer_id, focus_areas, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(record.id, record.developer_id, JSON.stringify(record.focus_areas), record.created_at);
    return record;
  }
}
