// Local service entry point. The MCP server (BE-3) and REST API (BE-12) start here.
export const SERVICE_NAME = "devgym";
export const SERVICE_VERSION = "0.1.0";

export { defaultDbPath, openDb, transaction, type Db } from "./db/connection.js";
export { migrate, migrations, type Migration } from "./db/migrations.js";
export { seed } from "./db/seed.js";
export type { TicketAdapter, TicketData } from "./tickets/adapter.js";
export { MarkdownTicketAdapter, parseTicketMarkdown } from "./tickets/markdown.js";
