import { useState } from "react";
import { Link, useParams } from "react-router";
import type { ForkResultResponse, ForkRun } from "@ftc/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { ForkQuestion } from "../components/ForkQuestion";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { TicketBody } from "../components/TicketBody";
import { plural, summarize } from "../lib/fork";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function Summary({ run }: { run: ForkRun }) {
  const { total, answeredByPo, assumedByDev } = summarize(run);
  if (total === 0) {
    return <p className="summary__line">Fork found nothing in this ticket that would change the code.</p>;
  }
  return (
    <div className="summary">
      <p className="summary__line">
        {plural(total, "question")} would change the code. The PO answered {answeredByPo}
        {assumedByDev > 0
          ? `; ${assumedByDev} ${assumedByDev === 1 ? "is an assumption" : "are assumptions"} to confirm before merge.`
          : ", so nothing is left as an assumption."}
      </p>
      <div
        className="summary__bar"
        role="img"
        aria-label={`${answeredByPo} answered by PO, ${assumedByDev} assumed by dev`}
      >
        {run.assumptions.map((assumption) => (
          <span key={assumption.id} className={`summary__cell summary__cell--${assumption.status}`} />
        ))}
      </div>
    </div>
  );
}

function ForkResult({ result }: { result: ForkResultResponse }) {
  const { ticket, runs } = result;
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const run = runs.find((r) => r.run_id === selectedRunId) ?? runs[0];

  return (
    <article className="fork-page">
      <header className="fork-page__head">
        <p className="fork-page__id">{ticket.id}</p>
        <h1 className="page-title">{ticket.title}</h1>
        {run && <Summary run={run} />}
      </header>

      <div className="fork-page__body">
        <section className="ticket" aria-labelledby="ticket-heading">
          <h2 id="ticket-heading">The ticket</h2>
          <TicketBody body={ticket.body} />
        </section>

        <section className="forks" aria-labelledby="forks-heading">
          <div className="forks__head">
            <h2 id="forks-heading">Questions and assumptions</h2>
            {runs.length > 1 && run && (
              <label className="run-picker">
                Fork run
                <select value={run.run_id} onChange={(event) => setSelectedRunId(event.target.value)}>
                  {runs.map((r, index) => (
                    <option key={r.run_id} value={r.run_id}>
                      {dateTime.format(new Date(r.created_at))}
                      {index === 0 ? " (latest)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {!run ? (
            <EmptyState title="Fork has not run on this ticket">
              <p>
                Run <code>/ftc:fork {ticket.id}</code> in Claude Code. Fork asks only the questions
                that would change the code, then saves the answers here.
              </p>
            </EmptyState>
          ) : run.assumptions.length === 0 ? (
            <EmptyState title="No questions">
              <p>Every reading of this ticket leads to the same code, so there was nothing to ask.</p>
            </EmptyState>
          ) : (
            <ol className="fork-list">
              {run.assumptions.map((assumption, index) => (
                <ForkQuestion key={assumption.id} assumption={assumption} number={index + 1} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </article>
  );
}

export function ForkPage() {
  const { ticketId = "" } = useParams();
  const result = useApi(`fork:${ticketId}`, (signal) => api.getForkResult(ticketId, signal));

  if (result.status === "loading") return <Loading what={`ticket ${ticketId}`} />;
  if (result.status === "error") {
    if (result.error.kind === "not_found") {
      return (
        <EmptyState title={`No ticket called ${ticketId}`}>
          <p>
            It is not in the local store. <Link to="/fork">See the tickets that are.</Link>
          </p>
        </EmptyState>
      );
    }
    return <ErrorState error={result.error} what={`ticket ${ticketId}`} />;
  }
  return <ForkResult key={ticketId} result={result.data} />;
}
