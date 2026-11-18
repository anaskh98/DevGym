// The ticket check: after coding, compare the change with the ticket. The AI may name code that is missing, extra
// (works, but nobody asked for it) or different from the ticket, only with a ticket quote the server finds in the
// ticket and lines the server finds in the pull request's change. The developer decides, in their own words.
// Findings stay on this machine: they are never shown to reviewers.
import { randomUUID } from "node:crypto";
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";
import { repoIdentity } from "../git/identity.js";
import { run, type Run } from "../pointers/git.js";
import { isSupported, symbolAtLine } from "../pointers/symbols.js";
import { aiHashesFor, lineHash, normalizeLine } from "./attribution.js";
import { quoteInSession } from "./messages.js";
import { quoteIn } from "./quote.js";
import { addedLinesInChange } from "./review.js";
import type { Track } from "./ladder/schema.js";
import { getTracks } from "./settings.js";
import { ladderForItem } from "./status.js";

export type FindingKind = "missing" | "extra" | "different";

export interface ProposeFindingInput {
  ticket_id: string;
  kind: FindingKind;
  ticket_quote: string;
  file?: string | undefined;
  line_start?: number | undefined;
  line_end?: number | undefined;
  base?: string | undefined;
  why: string;
}

/** The requirements-and-scope item for the track: BE.REQ.J1 (builds what is asked) or BE.REQ.M1 (spots unclear needs). */
export function reqItem(file: string | null, tracks: Track[], level: "J1" | "M1"): string {
  const web = file !== null && /\.(tsx|jsx|vue|svelte|css|html)$/i.test(file);
  const frontend = web || (tracks.length === 1 && tracks[0] === "frontend");
  return `${frontend ? "FE" : "BE"}.REQ.${level}`;
}

/** The requirements-and-scope item in the active ladder, or null: a company ladder may not have these items. */
function reqItemIn(root: string, itemId: string, home: string | undefined): { ladder_id: string } | null {
  try {
    return { ladder_id: ladderForItem(root, itemId, home ? { home } : {}).loaded.ladder_id };
  } catch {
    return null;
  }
}

/** The words a quote may come from: the ticket, and the Fork assumptions with their answers. */
function ticketCorpus(db: Db, ticket: { title: string; body: string }, ticketId: string): string {
  const rows = db.prepare("SELECT text, answer FROM assumptions WHERE ticket_id = ?").all(ticketId) as { text: string; answer: string | null }[];
  return [ticket.title, ticket.body, ...rows.flatMap((r) => [r.text, r.answer ?? ""])].join("\n");
}

export async function proposeFinding(
  db: Db,
  root: string,
  ticket: { title: string; body: string },
  input: ProposeFindingInput,
  exec: Run = run,
  home?: string,
): Promise<{ finding_id: string; evidence_id: string | null; owned: boolean }> {
  if (!quoteIn(ticketCorpus(db, ticket, input.ticket_id), input.ticket_quote)) {
    throw new StoreError("The ticket_quote is not in the ticket or its assumptions. Copy the words exactly");
  }
  const needsLines = input.kind !== "missing";
  if (needsLines && (input.file === undefined || input.line_start === undefined || input.line_end === undefined)) {
    throw new StoreError(`A '${input.kind}' finding needs file, line_start and line_end: the code that is ${input.kind === "extra" ? "not asked for" : "different from the ticket"}`);
  }
  const identity = await repoIdentity(root, exec);
  if (identity === null && needsLines) throw new StoreError("This folder is not a git repo");

  let author: "ai" | "dev" = "dev";
  let symbol: string | null = null;
  let file: string | null = null;
  let commit: string | null = null;
  if (needsLines && identity !== null) {
    const found = await addedLinesInChange(identity.top, input.base, input.file!, input.line_start!, input.line_end!, exec);
    file = found.path;
    commit = found.head;
    const ai = aiHashesFor(db, identity.key, found.path);
    author = found.lines.some((l) => {
      const n = normalizeLine(l.text);
      return n !== null && ai.has(lineHash(n));
    })
      ? "ai"
      : "dev";
    const source = await exec("git", ["show", `HEAD:${found.path}`], identity.top);
    symbol = source.code === 0 && isSupported(found.path) ? ((await symbolAtLine(found.path, source.stdout, found.lines[0]!.line))?.name ?? null) : null;
  }

  const itemId = reqItem(file ?? input.file ?? null, getTracks(db), "J1");
  const ladder = reqItemIn(identity?.top ?? root, itemId, home);
  const owned = author === "ai";
  // A company ladder without this item still gets the finding; it just has no skill to count it against.
  let evidenceId: string | null = null;
  if (ladder !== null) {
    evidenceId = randomUUID();
    db.prepare(
      `INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, owned, repo_root, commit_sha, file_path, symbol, ticket, note, at)
       VALUES (?, ?, ?, 'ticket_check', 'negative', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(evidenceId, ladder.ladder_id, itemId, author, owned ? 1 : 0, identity?.key ?? null, commit, file, symbol, input.ticket_id, `${input.kind}: ${input.why}`, new Date().toISOString());
  }
  const findingId = randomUUID();
  db.prepare(
    "INSERT INTO ticket_findings (id, ticket_id, kind, ticket_quote, file_path, line_start, line_end, why, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(findingId, input.ticket_id, input.kind, input.ticket_quote, file, input.line_start ?? null, input.line_end ?? null, input.why, evidenceId);
  return { finding_id: findingId, evidence_id: evidenceId, owned };
}

/**
 * The developer decides what to do with a finding, in their own words: the server checks the words are in a message
 * they sent in this session. A finding they decided on, before the pull request, is not counted as a fault.
 */
export function decideFinding(db: Db, input: { finding_id: string; session_id: string; choice: "fixed" | "kept"; reason_quote: string }): { decided: true } {
  const row = db.prepare("SELECT ticket_id, choice, evidence_id, created_at FROM ticket_findings WHERE id = ?").get(input.finding_id) as
    | { ticket_id: string; choice: string | null; evidence_id: string | null; created_at: string }
    | undefined;
  if (!row) throw new StoreError(`Finding '${input.finding_id}' does not exist`);
  if (row.choice !== null) throw new StoreError("This finding was already decided");
  // Only words sent after the finding was raised: an older message cannot be reused to settle it.
  if (!quoteInSession(db, input.session_id, input.reason_quote, row.created_at)) {
    throw new StoreError("Those words are not in a message the developer sent in this session. Ask them to say what they decide and why, then copy their words");
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE ticket_findings SET choice = ?, reason_quote = ?, decided_at = ? WHERE id = ?").run(input.choice, input.reason_quote, now, input.finding_id);
  // Decided in the same ticket, before it shipped: not counted as a fault (the engine skips a fault fixed in its own ticket).
  if (row.evidence_id !== null) db.prepare("UPDATE skill_evidence SET fixed_at = ?, fixed_ticket = ? WHERE id = ?").run(now, row.ticket_id, row.evidence_id);
  return { decided: true };
}

/** A clean check on a ticket with 3 or more needs is a positive sign for "builds what the ticket asks". Once per ticket. */
export function finishTicketCheck(db: Db, root: string, input: { ticket_id: string; needs: number }, home?: string): { credited: boolean; findings: number } {
  const findings = Number((db.prepare("SELECT count(*) AS n FROM ticket_findings WHERE ticket_id = ?").get(input.ticket_id) as { n: number }).n);
  if (findings > 0 || input.needs < 3) return { credited: false, findings };
  const itemId = reqItem(null, getTracks(db), "J1");
  const ladder = reqItemIn(root, itemId, home);
  if (ladder === null) return { credited: false, findings };
  const exists = db.prepare("SELECT 1 FROM skill_evidence WHERE ladder_id = ? AND item_id = ? AND kind = 'ticket_check' AND polarity = 'positive' AND symbol = ?").get(ladder.ladder_id, itemId, input.ticket_id);
  if (exists) return { credited: false, findings };
  insertTicketCredit(db, ladder.ladder_id, itemId, input.ticket_id);
  return { credited: true, findings };
}

/** Positive ticket-check evidence. The ticket goes in `symbol` so each ticket is its own proof. */
export function insertTicketCredit(db: Db, ladderId: string, itemId: string, ticketId: string): void {
  db.prepare(
    `INSERT INTO skill_evidence (id, ladder_id, item_id, kind, polarity, author, ticket, symbol, note, at)
     VALUES (?, ?, ?, 'ticket_check', 'positive', 'dev', ?, ?, ?, ?)`,
  ).run(randomUUID(), ladderId, itemId, ticketId, ticketId, "ticket check", new Date().toISOString());
}

/** Fork asked the product owner and saved the answers: that is spotting unclear needs before coding. Once per ticket. */
export function creditSpottedNeeds(db: Db, root: string, ticketId: string, askedPo: boolean, home?: string): void {
  if (!askedPo || getTracks(db).length === 0) return;
  const itemId = reqItem(null, getTracks(db), "M1");
  const ladder = reqItemIn(root, itemId, home);
  if (ladder === null) return;
  const exists = db.prepare("SELECT 1 FROM skill_evidence WHERE ladder_id = ? AND item_id = ? AND kind = 'ticket_check' AND polarity = 'positive' AND symbol = ?").get(ladder.ladder_id, itemId, ticketId);
  if (!exists) insertTicketCredit(db, ladder.ladder_id, itemId, ticketId);
}
