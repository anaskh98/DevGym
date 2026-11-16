export interface TicketData {
  id: string;
  title: string;
  body: string;
}

/**
 * Where tickets come from. Markdown files today; a Jira adapter can implement the same
 * interface later. Async on purpose: a remote source needs it.
 */
export interface TicketAdapter {
  /** Stored with the ticket, for example "markdown" or "jira". */
  readonly source: string;
  /** Returns null when the source has no ticket with this id. */
  getTicket(id: string): Promise<TicketData | null>;
}
