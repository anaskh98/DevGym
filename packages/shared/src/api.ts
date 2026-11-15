/**
 * Response shapes shared by the REST API (BE-12) and the web app.
 *
 * The web app's mock JSON uses exactly these shapes, so switching from mocks
 * to the real API is one config change (VITE_API_MODE).
 */
import { z } from "zod";
import { Assumption, Ticket } from "./records";

/** GET /api/tickets */
export const TicketSummary = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  fork_runs: z.number().int(),
  updated_at: z.string(),
});
export type TicketSummary = z.infer<typeof TicketSummary>;

export const TicketListResponse = z.object({
  tickets: z.array(TicketSummary),
});
export type TicketListResponse = z.infer<typeof TicketListResponse>;

/** One /fork run: the assumption list saved by one save_assumptions call. */
export const ForkRun = z.object({
  run_id: z.string(),
  created_at: z.string(),
  assumptions: z.array(Assumption),
});
export type ForkRun = z.infer<typeof ForkRun>;

/** GET /api/tickets/:id/fork — newest run first. */
export const ForkResultResponse = z.object({
  ticket: Ticket,
  runs: z.array(ForkRun),
});
export type ForkResultResponse = z.infer<typeof ForkResultResponse>;

/** Paths, relative to the API base. Mock mode maps them to static JSON files. */
export const API_PATHS = {
  tickets: () => "/api/tickets",
  forkResult: (ticketId: string) => `/api/tickets/${encodeURIComponent(ticketId)}/fork`,
} as const;
