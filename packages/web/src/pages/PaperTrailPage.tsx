import { Fragment, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  DECISION_ORIGIN_LABEL,
  EXPLAIN_BACK_RATING_LABEL,
  type DecisionOrigin,
  type PaperTrailResponse,
} from "@ftc/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { DecisionItem } from "../components/DecisionItem";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { TicketHead } from "../components/TicketHead";
import { plural } from "../lib/fork";
import { useTitle } from "../lib/useTitle";
import { countByOrigin, countByRating, ORIGINS, originSentence, RATINGS, sessionNumbers } from "../lib/trail";

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "full" });

function explainSentence(decisions: PaperTrailResponse["decisions"]): string | null {
  const counts = countByRating(decisions);
  const total = RATINGS.reduce((sum, rating) => sum + counts[rating], 0);
  if (total === 0) return null;
  const parts = RATINGS.filter((rating) => counts[rating] > 0).map(
    (rating) => `${counts[rating]} ${EXPLAIN_BACK_RATING_LABEL[rating]}`,
  );
  return `The developer explained ${total} back: ${parts.join(", ")}.`;
}

function Trail({ result }: { result: PaperTrailResponse }) {
  const { ticket, decisions } = result;
  useTitle(`Paper Trail: ${ticket.id}`);
  const [origin, setOrigin] = useState<DecisionOrigin | "all">("all");

  // The Coach page links to one decision: ?decision=<id>. Bring it into view.
  const [params] = useSearchParams();
  const wanted = params.get("decision");
  const focusId = decisions.some((decision) => decision.id === wanted) ? wanted : null;
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
            Paper Trail records a decision each time Claude Code or the developer makes a choice
            while coding the ticket. Nothing has been recorded for <code>{ticket.id}</code> yet.
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

          <p className="trail__day">{day.format(new Date(first.created_at))}</p>
          <ol className="trail__list">
            {shown.map(({ decision, session }, index) => {
              const previous = shown[index - 1];
              const newSession = manySessions && (!previous || previous.session !== session);
              return (
                <Fragment key={decision.id}>
                  {newSession && <li className="trail__session">Coding session {session}</li>}
                  <DecisionItem decision={decision} highlighted={decision.id === focusId} />
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
    </article>
  );
}

export function PaperTrailPage() {
  const { ticketId = "" } = useParams();
  const result = useApi(`trail:${ticketId}`, (signal) => api.getTrail(ticketId, signal));

  if (result.status === "loading") return <Loading what={`the trail for ${ticketId}`} />;
  if (result.status === "error") {
    if (result.error.kind === "not_found") {
      return (
        <EmptyState title={`No ticket called ${ticketId}`}>
          <p>
            It is not in the local store. <Link to="/paper-trail">See the tickets that are.</Link>
          </p>
        </EmptyState>
      );
    }
    return <ErrorState error={result.error} what={`the trail for ${ticketId}`} />;
  }
  return <Trail key={ticketId} result={result.data} />;
}
