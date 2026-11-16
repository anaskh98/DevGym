import type { ReactNode } from "react";
import { NavLink } from "react-router";
import type { Ticket } from "@ftc/shared";

/**
 * The top of a ticket page: id, title, and links between the two views of
 * the same ticket.
 */
export function TicketHead({ ticket, children }: { ticket: Pick<Ticket, "id" | "title">; children?: ReactNode }) {
  const id = encodeURIComponent(ticket.id);
  return (
    <header className="ticket-head">
      <p className="ticket-head__id">{ticket.id}</p>
      <h1 className="page-title">{ticket.title}</h1>
      <nav className="ticket-head__views" aria-label="Views of this ticket">
        <NavLink to={`/fork/${id}`}>Fork</NavLink>
        <NavLink to={`/paper-trail/${id}`}>Paper Trail</NavLink>
      </nav>
      {children}
    </header>
  );
}
