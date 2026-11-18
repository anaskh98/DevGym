import { Fragment, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  DECISION_ORIGIN_LABEL,
  EXPLAIN_BACK_RATING_LABEL,
  type DecisionOrigin,
  type TicketDetailResponse,
} from "@devgym/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { DecisionItem } from "../components/DecisionItem";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { TicketHead } from "../components/TicketHead";
import { plural } from "../lib/clarify";
import { formatFullDay } from "../lib/dates";
import { useTitle } from "../lib/useTitle";
import { countByOrigin, countByRating, ORIGINS, originSentence, RATINGS, sessionNumbers } from "../lib/trail";

function explainSentence(decisions: TicketDetailResponse["decisions"]): string | null {
  const counts = countByRating(decisions);
  const total = RATINGS.reduce((sum, rating) => sum + counts[rating], 0);
  if (total === 0) return null;
  const parts = RATINGS.filter((rating) => counts[rating] > 0).map(
    (rating) => `${counts[rating]} ${EXPLAIN_BACK_RATING_LABEL[rating]}`,
  );
  return `The developer explained ${total}: ${parts.join(", ")}.`;
}

function Trail({ result }: { result: TicketDetailResponse }) {
  const { ticket, decisions, sessions: trailSessions } = result;
  const unexplained = [...new Set(trailSessions.flatMap((session) => session.unexplained_files))];
  useTitle(`Track: ${ticket.id}`);
  const [origin, setOrigin] = useState<DecisionOrigin | "all">("all");

  // The Grow page links to one piece of evidence: ?item=<decision or explanation id>. Bring it into view.
  const [params] = useSearchParams();
  const wanted = params.get("item");
  const focusDecision = decisions.find(
    (decision) => decision.id === wanted || decision.explain_backs.some((e) => e.id === wanted),
  );
  const focusId = focusDecision ? wanted : null;
  useEffect(() => {
    if (!focusId) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(focusId)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }, [focusId]);

  const counts = countByOrigin(decisions);
  const sessions = sessionNumbers(decisions);
  const manySessions = new Set(sessions).size > 1;
  const explained = explainSentence(decisions);
  const shown = decisions
    .map((decision, index) => ({ decision, session: sessions[index] ?? 1 }))
    .filter(({ decision }) => origin === "all" || decision.origin === origin);
  const first = decisions[0];

  return (
    <article className="trail-page">
      <TicketHead ticket={ticket}>
        {decisions.length > 0 && (
          <p className="summary__line">
            {originSentence(decisions)}
            {explained ? ` ${explained}` : ""}
          </p>
        )}
      </TicketHead>

      {decisions.length === 0 || !first ? (
        <EmptyState title="No decisions logged for this ticket">
          <p>
            Run <code>/devgym:track {ticket.id}</code> in Claude Code before coding the ticket. Each
            real choice made while coding is then logged here, with who made it.
          </p>
        </EmptyState>
      ) : (
        <section className="trail" aria-labelledby="trail-heading">
          <div className="trail__head">
            <h2 id="trail-heading">Decisions, in the order they were made</h2>
            <div className="filter" role="group" aria-label="Show decisions made by">
              <button type="button" aria-pressed={origin === "all"} onClick={() => setOrigin("all")}>
                All {decisions.length}
              </button>
              {ORIGINS.filter((value) => counts[value] > 0).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={origin === value}
                  onClick={() => setOrigin(value)}
                >
                  {DECISION_ORIGIN_LABEL[value]} {counts[value]}
                </button>
              ))}
            </div>
          </div>

          <p className="trail__day">{formatFullDay(first.created_at)}</p>
          <ol className="trail__list">
            {shown.map(({ decision, session }, index) => {
              const previous = shown[index - 1];
              const newSession = manySessions && (!previous || previous.session !== session);
              return (
                <Fragment key={decision.id}>
                  {newSession && <li className="trail__session">Coding session {session}</li>}
                  <DecisionItem decision={decision} highlighted={decision === focusDecision} />
                </Fragment>
              );
            })}
          </ol>
          {origin !== "all" && (
            <p className="trail__filtered">
              Showing {plural(shown.length, "decision")} of {decisions.length}.{" "}
              <button type="button" className="link-button" onClick={() => setOrigin("all")}>
                Show all
              </button>
            </p>
          )}
        </section>
      )}

      {unexplained.length > 0 && (
        <section className="unexplained" aria-labelledby="unexplained-heading">
          <h2 id="unexplained-heading">Edited with no decision</h2>
          <p>
            These files were changed while coding the ticket, but no logged decision points at them. That is fine for
            routine edits; a reviewer may still ask why they changed.
          </p>
          <ul>
            {unexplained.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}

export function TrackPage() {
  const { ticketId = "" } = useParams();
  const result = useApi(`ticket:${ticketId}`, (signal) => api.getTicket(ticketId, signal));

  if (result.status === "loading") return <Loading what={`the trail for ${ticketId}`} />;
  if (result.status === "error") {
    if (result.error.kind === "not_found") {
      return (
        <EmptyState title={`No ticket called ${ticketId}`}>
          <p>
            It is not in the local store. <Link to="/track">See the tickets that are.</Link>
          </p>
        </EmptyState>
      );
    }
    return <ErrorState error={result.error} what={`the trail for ${ticketId}`} />;
  }
  return <Trail key={ticketId} result={result.data} />;
}
