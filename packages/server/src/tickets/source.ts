/**
 * Where tickets come from. The thin path reads Markdown files; a Jira adapter
 * implements the same interface later, and nothing else has to change.
 */
export interface SourceTicket {
  id: string;
  title: string;
  body: string;
}

export interface TicketSource {
  /** Stored on the ticket as its `source`, e.g. "markdown" or "jira". */
  readonly name: string;
  get(id: string): Promise<SourceTicket | null>;
  list(): Promise<SourceTicket[]>;
}

/** Ticket ids are used in file names and URLs, so keep them plain. */
export const TICKET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function isValidTicketId(id: string): boolean {
  return TICKET_ID_PATTERN.test(id) && !id.includes("..");
}
