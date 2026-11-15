/**
 * pnpm db:seed — load the demo ticket(s) into the local SQLite file.
 *
 *   --tickets <dir>   Markdown tickets to load. Default: FTC_TICKETS_DIR,
 *                     then demo-repo/tickets in this repo.
 */
import { loadConfig } from "../config";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { Store } from "../db/store";
import { PendingGuard } from "../privacy/guard";
import { MarkdownTicketSource } from "../tickets/markdown";
import { DEMO_TICKETS_DIR, flag } from "./shared";

const config = loadConfig();
const ticketsDir = flag("tickets") ?? process.env.FTC_TICKETS_DIR ?? DEMO_TICKETS_DIR;

const db = openDb(config.dbPath);
migrate(db);
const store = new Store(db, { guard: new PendingGuard() });
const source = new MarkdownTicketSource(ticketsDir);

const tickets = await source.list();
if (tickets.length === 0) {
  console.error(`No tickets found in ${ticketsDir}`);
  process.exit(1);
}
for (const ticket of tickets) {
  store.upsertTicket({ ...ticket, source: source.name });
  console.log(`seeded ${ticket.id}: ${ticket.title}`);
}
console.log(`database: ${config.dbPath}`);
db.close();
