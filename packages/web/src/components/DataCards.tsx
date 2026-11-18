import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AssumptionStatus, DecisionOrigin, ExplainBackRating, type ExportResponse } from "@ftc/shared";
import { formatDayTime } from "../lib/dates";
import { plural } from "../lib/fork";
import { countBy, flag, indexBy, list, num, plainPreview, text, type Row } from "../lib/myData";
import { OriginBadge } from "./OriginBadge";
import { RatingTag } from "./RatingTag";
import { StatusTag } from "./StatusTag";

/** How many cards a section shows before "Show all". */
const FIRST = 6;

/** Rows from other tables, so a card can say what an id points to. */
interface Lookup {
  tickets: Map<string, Row>;
  decisions: Map<string, Row>;
  pointers: Map<string, Row>;
  observations: Map<string, Row>;
  focusAreas: Map<string, Row>;
  editsBySession: Map<string, number>;
  decisionsBySession: Map<string, number>;
  explainsByDecision: Map<string, number>;
}

function buildLookup(data: ExportResponse["data"]): Lookup {
  const focusAreas = new Map<string, Row>();
  for (const plan of data.growth_plans ?? []) {
    for (const area of list(plan, "focus_areas")) {
      if (area && typeof area === "object") {
        const row = area as Row;
        if (text(row, "id")) focusAreas.set(text(row, "id"), row);
      }
    }
  }
  return {
    tickets: indexBy(data.tickets, "id"),
    decisions: indexBy(data.decisions, "id"),
    pointers: indexBy(data.pointers, "id"),
    observations: indexBy(data.observations, "id"),
    focusAreas,
    editsBySession: countBy(data.file_edits, "session_id"),
    decisionsBySession: countBy(data.decisions, "session_id"),
    explainsByDecision: countBy(data.explain_backs, "decision_id"),
  };
}

function When({ value, label = "" }: { value: string; label?: string }) {
  if (!value) return null;
  let shown = value;
  try {
    shown = formatDayTime(value);
  } catch {
    // Not a date the service writes; show it as stored.
  }
  return (
    <time className="rec__when" dateTime={value}>
      {label}
      {shown}
    </time>
  );
}

function TicketChip({ id, lookup }: { id: string; lookup: Lookup }) {
  if (!id) return null;
  const ticket = lookup.tickets.get(id);
  return (
    <Link className="chip chip--ticket" to={`/fork/${encodeURIComponent(id)}`} title={ticket ? text(ticket, "title") : id}>
      {id}
    </Link>
  );
}

function Card({ head, children, foot, tone }: { head?: ReactNode; children: ReactNode; foot?: ReactNode; tone?: string }) {
  return (
    <li className={`rec${tone ? ` rec--${tone}` : ""}`}>
      {head && <div className="rec__head">{head}</div>}
      <div className="rec__body">{children}</div>
      {foot && <div className="rec__foot">{foot}</div>}
    </li>
  );
}

function PointerText({ pointer }: { pointer: Row }) {
  const line = num(pointer, "line_hint");
  const symbol = text(pointer, "symbol");
  return (
    <code className="rec__path">
      {text(pointer, "file_path")}
      {line !== null ? `:${line}` : ""}
      {symbol ? ` · ${symbol}` : ""}
    </code>
  );
}

function decisionTitle(lookup: Lookup, id: string): string {
  const decision = lookup.decisions.get(id);
  return decision ? text(decision, "summary") : "";
}

/** One card per row, laid out for what that table holds. */
function RowCard({ table, row, lookup }: { table: string; row: Row; lookup: Lookup }) {
  switch (table) {
    case "tickets": {
      const id = text(row, "id");
      const source = text(row, "source");
      return (
        <Card
          head={
            <>
              <TicketChip id={id} lookup={lookup} />
              {source && <span className={`chip chip--source chip--${source}`}>{source === "jira" ? "Jira" : source}</span>}
            </>
          }
          foot={<When value={text(row, "created_at")} label="Saved " />}
        >
          <h3 className="rec__title">{text(row, "title")}</h3>
          {text(row, "body") && <p className="rec__clamp">{plainPreview(text(row, "body"))}</p>}
        </Card>
      );
    }

    case "assumptions": {
      const status = AssumptionStatus.safeParse(row.status);
      return (
        <Card
          tone={status.success ? status.data : undefined}
          head={
            <>
              <TicketChip id={text(row, "ticket_id")} lookup={lookup} />
              {status.success && <StatusTag status={status.data} />}
            </>
          }
          foot={<When value={text(row, "created_at")} />}
        >
          <p className="rec__title">{text(row, "text")}</p>
          {text(row, "answer") && <p className="rec__answer">{text(row, "answer")}</p>}
        </Card>
      );
    }

    case "trail_sessions": {
      const session = text(row, "session_id");
      return (
        <Card
          head={<TicketChip id={text(row, "ticket_id")} lookup={lookup} />}
          foot={<When value={text(row, "started_at")} label="Started " />}
        >
          <dl className="rec__stats">
            <div>
              <dt>Files edited</dt>
              <dd>{lookup.editsBySession.get(session) ?? 0}</dd>
            </div>
            <div>
              <dt>Decisions</dt>
              <dd>{lookup.decisionsBySession.get(session) ?? 0}</dd>
            </div>
          </dl>
          <p className="rec__muted">
            Session <code>{session.slice(0, 12)}</code>
          </p>
        </Card>
      );
    }

    case "file_edits": {
      const edits = num(row, "edit_count") ?? 0;
      return (
        <Card foot={<When value={text(row, "last_edited_at")} label="Last edit " />}>
          <code className="rec__path">{text(row, "file_path")}</code>
          <p className="rec__muted">{plural(edits, "edit")}</p>
        </Card>
      );
    }

    case "decisions": {
      const origin = DecisionOrigin.safeParse(row.origin);
      const pointer = lookup.pointers.get(text(row, "pointer_id"));
      const alternatives = list(row, "alternatives").filter((a): a is string => typeof a === "string");
      const explained = lookup.explainsByDecision.get(text(row, "id")) ?? 0;
      return (
        <Card
          head={
            <>
              <TicketChip id={text(row, "ticket_id")} lookup={lookup} />
              {origin.success && <OriginBadge origin={origin.data} />}
              {explained > 0 && <span className="chip">explained</span>}
            </>
          }
          foot={<When value={text(row, "created_at")} />}
        >
          <p className="rec__title">{text(row, "summary")}</p>
          {alternatives.length > 0 && (
            <div className="rec__alts">
              <span className="rec__label">Instead of</span>
              <ul>
                {alternatives.map((alt) => (
                  <li key={alt}>{alt}</li>
                ))}
              </ul>
            </div>
          )}
          {pointer && <PointerText pointer={pointer} />}
        </Card>
      );
    }

    case "pointers": {
      const resolved = flag(row, "resolved");
      const repo = text(row, "repo");
      const sha = text(row, "commit_sha");
      const pr = num(row, "pr_number");
      return (
        <Card
          tone={resolved ? "ok" : "warn"}
          head={
            <span className={`chip ${resolved ? "chip--ok" : "chip--warn"}`}>{resolved ? "resolves" : "not checked"}</span>
          }
          foot={<When value={text(row, "resolved_at") || text(row, "created_at")} />}
        >
          <PointerText pointer={row} />
          <p className="rec__muted">
            {repo}
            {pr !== null ? ` · PR ${pr}` : ""}
            {sha ? ` · ${sha.slice(0, 7)}` : ""}
          </p>
          {text(row, "resolve_note") && <p className="rec__muted">{text(row, "resolve_note")}</p>}
        </Card>
      );
    }

    case "explain_backs": {
      const rating = ExplainBackRating.safeParse(row.rating);
      const about = decisionTitle(lookup, text(row, "decision_id"));
      return (
        <Card
          tone={rating.success ? rating.data : undefined}
          head={rating.success && <RatingTag rating={rating.data} />}
          foot={<When value={text(row, "created_at")} />}
        >
          <p className="rec__title">{text(row, "question")}</p>
          <blockquote className="rec__quote">{text(row, "answer")}</blockquote>
          {about && <p className="rec__muted">About: {about}</p>}
        </Card>
      );
    }

    case "observations": {
      const evidence = list(row, "evidence_ids").length;
      return (
        <Card
          head={text(row, "skill_tag") && <span className="chip chip--skill">{text(row, "skill_tag")}</span>}
          foot={
            <>
              <span>{plural(evidence, "piece")} of evidence</span>
              <When value={text(row, "created_at")} />
            </>
          }
        >
          <p className="rec__title">{text(row, "summary")}</p>
        </Card>
      );
    }

    case "growth_plans": {
      const areas = list(row, "focus_areas").filter((a): a is Row => !!a && typeof a === "object");
      return (
        <Card tone="wide" foot={<When value={text(row, "created_at")} label="Built " />}>
          <h3 className="rec__title">{plural(areas.length, "focus area")}</h3>
          <ol className="rec__areas">
            {areas.map((area, i) => (
              <li key={text(area, "id") || i}>
                <p className="rec__claim">
                  {text(area, "claim")} {flag(area, "tentative") && <span className="tag tag--tentative">tentative</span>}
                </p>
                <p className="rec__exercise">
                  <span className="rec__label">Exercise</span> {text(area, "exercise")}
                </p>
                <p className="rec__muted">{plural(list(area, "evidence_ids").length, "observation")} as evidence</p>
              </li>
            ))}
          </ol>
        </Card>
      );
    }

    case "annotations": {
      const target = text(row, "target_id");
      const area = lookup.focusAreas.get(target);
      const on = area ? text(area, "claim") : decisionTitle(lookup, target);
      return (
        <Card
          tone={flag(row, "disagrees") ? "disagreed" : undefined}
          head={flag(row, "disagrees") && <span className="tag tag--disagreed">I disagree</span>}
          foot={<When value={text(row, "created_at")} />}
        >
          <p className="rec__title">{text(row, "note")}</p>
          {on && <p className="rec__muted">On: {on}</p>}
        </Card>
      );
    }

    default:
      return (
        <Card>
          <dl className="rec__fields">
            {Object.entries(row).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      );
  }
}

/** The records of one table: cards, or the raw rows exactly as stored. */
export function TableSection({
  table,
  label,
  what,
  response,
}: {
  table: string;
  label: string;
  what: string;
  response: ExportResponse;
}) {
  const [raw, setRaw] = useState(false);
  const [all, setAll] = useState(false);
  const lookup = useMemo(() => buildLookup(response.data), [response]);
  const rows = response.data[table] ?? [];
  const shown = all ? rows : rows.slice(0, FIRST);

  return (
    <section className="store" id={`store-${table}`} aria-labelledby={`store-${table}-title`}>
      <header className="store__head">
        <div>
          <h3 id={`store-${table}-title`} className="store__title">
            {label} <span className="store__count">{rows.length}</span>
          </h3>
          <p className="store__what">{what}</p>
        </div>
        {rows.length > 0 && (
          <button type="button" className="store__toggle" aria-pressed={raw} onClick={() => setRaw((r) => !r)}>
            {raw ? "Show as cards" : "Show raw JSON"}
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="store__none">None stored.</p>
      ) : raw ? (
        <pre className="kind__records" tabIndex={0}>
          {JSON.stringify(rows, null, 2)}
        </pre>
      ) : (
        <>
          <ul className={`recs recs--${table}`}>
            {shown.map((row, i) => (
              <RowCard key={text(row, "id") || `${text(row, "session_id")}:${text(row, "file_path")}` || i} table={table} row={row} lookup={lookup} />
            ))}
          </ul>
          {rows.length > FIRST && (
            <button type="button" className="store__more" onClick={() => setAll((a) => !a)}>
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
