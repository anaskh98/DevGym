// Builds the "Decisions" section of a pull request.
// This is the ONLY thing that leaves the developer's machine, so it is built from a fixed list
// of fields: the ticket's assumptions, and each decision's summary, alternatives, origin and pointer.
// Nothing from the developer's profile goes in: no explain-backs, ratings, observations,
// growth plans, notes, developer id or session id.
import type { Db } from "../db/connection.js";
import { StoreError } from "../errors.js";

export const SECTION_START = "<!-- fork-trail-coach:decisions:start -->";
export const SECTION_END = "<!-- fork-trail-coach:decisions:end -->";

const ORIGIN_LABEL: Record<string, string> = {
  ai: "AI chose",
  dev: "Developer chose",
  dev_changed_ai: "Developer changed the AI's choice",
};
const STATUS_LABEL: Record<string, string> = {
  answered_by_po: "Answered by PO",
  assumed_by_dev: "Assumed by dev",
};

/** Makes stored text safe to drop into GitHub markdown: one line, no table breaks, no pings, no HTML. */
function inline(text: string): string {
  return text
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/</g, "&lt;")
    .replace(/\|/g, "\\|")
    .replace(/@(?=\w)/g, "@​") // "@name" would notify a real GitHub user
    .trim();
}

interface AssumptionRow {
  text: string;
  status: string;
  answer: string | null;
}
interface DecisionRow {
  summary: string;
  alternatives: string;
  origin: string;
  repo: string | null;
  file_path: string | null;
  symbol: string | null;
  commit_sha: string | null;
  line_hint: number | null;
  resolved: number | null;
}

function pointerText(d: DecisionRow): string | null {
  if (!d.file_path) return null;
  const label = `\`${d.file_path}\`${d.symbol ? ` · \`${d.symbol}\`` : ""}`;
  const linkable = d.commit_sha && d.repo && /^[\w.-]+\/[\w.-]+$/.test(d.repo) && d.resolved !== 0;
  if (!linkable) return d.resolved === 0 ? `${label} (this pointer no longer finds its code)` : label;
  const path = d.file_path.split("/").map(encodeURIComponent).join("/");
  return `[${label}](https://github.com/${d.repo}/blob/${d.commit_sha}/${path}${d.line_hint ? `#L${d.line_hint}` : ""})`;
}

export interface SectionResult {
  markdown: string;
  assumptions: number;
  decisions: number;
}

export function buildDecisionsSection(db: Db, ticketId: string): SectionResult {
  const ticket = db.prepare("SELECT id, title FROM tickets WHERE id = ?").get(ticketId) as { id: string; title: string } | undefined;
  if (!ticket) throw new StoreError(`Ticket '${ticketId}' does not exist`);

  const assumptions = db
    .prepare("SELECT text, status, answer FROM assumptions WHERE ticket_id = ? ORDER BY rowid")
    .all(ticketId) as unknown as AssumptionRow[];
  const decisions = db
    .prepare(
      `SELECT d.summary, d.alternatives, d.origin, p.repo, p.file_path, p.symbol, p.commit_sha, p.line_hint, p.resolved
       FROM decisions d LEFT JOIN pointers p ON p.id = d.pointer_id
       WHERE d.ticket_id = ? ORDER BY d.rowid`,
    )
    .all(ticketId) as unknown as DecisionRow[];
  if (assumptions.length === 0 && decisions.length === 0) {
    throw new StoreError(`Ticket '${ticketId}' has no assumptions and no decisions to share yet`);
  }

  const lines: string[] = [SECTION_START, "## Decisions", "", `Ticket **${inline(ticket.id)}**: ${inline(ticket.title)}`, ""];

  if (assumptions.length > 0) {
    const assumed = assumptions.filter((a) => a.status === "assumed_by_dev").length;
    lines.push("### Assumptions", "", "| Question | Status | Answer |", "| --- | --- | --- |");
    for (const a of assumptions) {
      lines.push(`| ${inline(a.text)} | ${STATUS_LABEL[a.status] ?? inline(a.status)} | ${a.answer ? inline(a.answer) : ""} |`);
    }
    lines.push("");
    if (assumed > 0) {
      lines.push(`${assumed} of ${assumptions.length} ${assumed === 1 ? "is an assumption" : "are assumptions"} the product owner has not confirmed.`, "");
    }
  }

  if (decisions.length > 0) {
    lines.push("### Decisions made while coding", "");
    decisions.forEach((d, i) => {
      lines.push(`${i + 1}. **${inline(d.summary)}**`);
      lines.push(`   - Who chose: ${ORIGIN_LABEL[d.origin] ?? inline(d.origin)}`);
      const alternatives = (JSON.parse(d.alternatives) as string[]).map(inline).filter(Boolean);
      if (alternatives.length > 0) lines.push(`   - Alternatives considered: ${alternatives.join("; ")}`);
      const where = pointerText(d);
      if (where) lines.push(`   - Where: ${where}`);
    });
    lines.push("");
  }

  lines.push("<sub>Written by the Fork, Paper Trail, Coach plugin. Edit above or below this section; it is replaced when the command runs again.</sub>", SECTION_END);
  return { markdown: lines.join("\n"), assumptions: assumptions.length, decisions: decisions.length };
}

/** Puts the section into a PR body: replaces an earlier copy, or adds it at the end. The rest is untouched. */
export function mergeSection(body: string, section: string): string {
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END);
  if (start !== -1 && end > start) {
    return body.slice(0, start) + section + body.slice(end + SECTION_END.length);
  }
  const trimmed = body.replace(/\s+$/, "");
  return trimmed ? `${trimmed}\n\n${section}\n` : `${section}\n`;
}
