import { Link, Navigate } from "react-router";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { plural } from "../lib/fork";

/** Fork's index: the tickets in the local store. Goes straight to the ticket when there is one. */
export function TicketsPage() {
  const tickets = useApi("tickets", (signal) => api.listTickets(signal));

  if (tickets.status === "loading") return <Loading what="tickets" />;
  if (tickets.status === "error") return <ErrorState error={tickets.error} what="the tickets" />;

  const list = tickets.data.tickets;
  if (list.length === 0) {
    return (
      <EmptyState title="No tickets yet">
        <p>
          Run <code>/ftc:fork DEMO-1</code> in Claude Code, inside the demo repository. The ticket
          and its questions will appear here.
        </p>
      </EmptyState>
    );
  }
  const only = list.length === 1 ? list[0] : undefined;
  if (only) return <Navigate to={`/fork/${encodeURIComponent(only.id)}`} replace />;

  return (
    <>
      <h1 className="page-title">Tickets</h1>
      <ul className="ticket-list">
        {list.map((ticket) => (
          <li key={ticket.id}>
            <Link to={`/fork/${encodeURIComponent(ticket.id)}`}>
              <span className="ticket-list__id">{ticket.id}</span>
              <span className="ticket-list__title">{ticket.title}</span>
              <span className="ticket-list__runs">
                {ticket.fork_runs === 0 ? "Fork not run yet" : plural(ticket.fork_runs, "Fork run")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
