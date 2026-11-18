import { Link, Navigate } from "react-router";
import type { TicketSummary } from "@devgym/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Icon } from "../components/Icon";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { plural } from "../lib/clarify";
import { useTitle } from "../lib/useTitle";

type Section = "clarify" | "track";

const SECTION: Record<Section, { empty: string; meta: (ticket: TicketSummary) => string }> = {
  clarify: {
    empty: "The ticket and its questions will appear here.",
    meta: (ticket) =>
      ticket.assumption_count === 0 ? "No questions saved yet" : plural(ticket.assumption_count, "question"),
  },
  track: {
    empty: "The decisions made while coding it will appear here.",
    meta: (ticket) =>
      ticket.decision_count === 0 ? "No decisions yet" : plural(ticket.decision_count, "decision"),
  },
};

/**
 * The tickets in the local store, for Clarify or for Track.
 * Goes straight to the ticket when there is only one.
 */
export function TicketsPage({ section }: { section: Section }) {
  const tickets = useApi("tickets", (signal) => api.listTickets(signal));
  const { empty, meta } = SECTION[section];
  useTitle(section === "clarify" ? "Clarify" : "Track");

  if (tickets.status === "loading") return <Loading what="tickets" />;
  if (tickets.status === "error") return <ErrorState error={tickets.error} what="the tickets" />;

  const list = tickets.data.tickets;
  if (list.length === 0) {
    return (
      <EmptyState title="No tickets yet">
        <p>
          Run <code>/devgym:clarify DEMO-1</code> in Claude Code, inside the demo repository. {empty}
        </p>
      </EmptyState>
    );
  }
  const only = list.length === 1 ? list[0] : undefined;
  if (only) return <Navigate to={`/${section}/${encodeURIComponent(only.id)}`} replace />;

  return (
    <>
      <h1 className="page-title">Tickets</h1>
      <ul className="ticket-list">
        {list.map((ticket) => (
          <li key={ticket.id}>
            <Link to={`/${section}/${encodeURIComponent(ticket.id)}`}>
              <span className="ticket-list__id">{ticket.id}</span>
              <span className="ticket-list__title">{ticket.title}</span>
              <span className="ticket-list__runs">{meta(ticket)}</span>
              <span className="arrow">
                <Icon name="arrow" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
