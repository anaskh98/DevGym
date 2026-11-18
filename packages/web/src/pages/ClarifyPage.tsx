import { Link, useParams } from "react-router";
import type { Assumption, TicketDetailResponse } from "@devgym/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { ClarifyQuestion } from "../components/ClarifyQuestion";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { TicketBody } from "../components/TicketBody";
import { TicketHead } from "../components/TicketHead";
import { plural, summarize } from "../lib/clarify";
import { useTitle } from "../lib/useTitle";

function Summary({ assumptions }: { assumptions: Assumption[] }) {
  const { total, answeredByPo, assumedByDev } = summarize(assumptions);
  if (total === 0) return null;
  return (
    <div className="summary">
      <p className="summary__line">
        {plural(total, "question")} would change the code. The PO answered {answeredByPo}
        {assumedByDev > 0
          ? `; ${assumedByDev} ${assumedByDev === 1 ? "is an assumption" : "are assumptions"} to confirm before merge.`
          : ", so nothing is left as an assumption."}
      </p>
      <div className="summary__bar" role="img" aria-label={`${answeredByPo} answered by PO, ${assumedByDev} assumed by dev`}>
        {assumptions.map((assumption) => (
          <span key={assumption.id} className={`summary__cell summary__cell--${assumption.status}`} />
        ))}
      </div>
    </div>
  );
}

function ClarifyResult({ result }: { result: TicketDetailResponse }) {
  const { ticket, assumptions } = result;
  useTitle(`Clarify: ${ticket.id}`);

  return (
    <article className="fork-page">
      <TicketHead ticket={ticket}>
        <Summary assumptions={assumptions} />
      </TicketHead>

      <div className="fork-page__body">
        <section className="ticket" aria-labelledby="ticket-heading">
          <h2 id="ticket-heading">The ticket</h2>
          <TicketBody body={ticket.body} />
        </section>

        <section className="forks" aria-labelledby="forks-heading">
          <div className="forks__head">
            <h2 id="forks-heading">Questions and assumptions</h2>
          </div>
          {assumptions.length === 0 ? (
            <EmptyState title="No questions saved for this ticket">
              <p>
                Run <code>/devgym:clarify {ticket.id}</code> in Claude Code. Clarify asks only the questions that
                would change the code. If it finds none, it says so and saves nothing.
              </p>
            </EmptyState>
          ) : (
            <ol className="fork-list">
              {assumptions.map((assumption, index) => (
                <ClarifyQuestion key={assumption.id} assumption={assumption} number={index + 1} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </article>
  );
}

export function ClarifyPage() {
  const { ticketId = "" } = useParams();
  const result = useApi(`ticket:${ticketId}`, (signal) => api.getTicket(ticketId, signal));

  if (result.status === "loading") return <Loading what={`ticket ${ticketId}`} />;
  if (result.status === "error") {
    if (result.error.kind === "not_found") {
      return (
        <EmptyState title={`No ticket called ${ticketId}`}>
          <p>
            It is not in the local store. <Link to="/clarify">See the tickets that are.</Link>
          </p>
        </EmptyState>
      );
    }
    return <ErrorState error={result.error} what={`ticket ${ticketId}`} />;
  }
  return <ClarifyResult key={ticketId} result={result.data} />;
}
