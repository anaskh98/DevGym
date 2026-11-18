import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { MarkdownTicketAdapter } from "../tickets/markdown.js";
import { createServer } from "./server.js";

// stdout carries the MCP protocol. Log to stderr only.
const db = openDb();
migrate(db);

// Tickets come from the project first ("tickets" folder where Claude Code runs, or DEVGYM_TICKETS_DIR),
// then from the demo tickets that ship next to this file inside the plugin.
const projectTickets = process.env.DEVGYM_TICKETS_DIR ?? join(process.cwd(), "tickets");
const demoTickets = join(dirname(fileURLToPath(import.meta.url)), "..", "demo-tickets");
const tickets = new MarkdownTicketAdapter([projectTickets, demoTickets]);

// The built web app ships in "web" next to this file's folder, when the plugin includes it.
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const port = process.env.DEVGYM_PORT ? Number(process.env.DEVGYM_PORT) : undefined;

const server = createServer(db, tickets, { report: { webDir, port } });
await server.connect(new StdioServerTransport());
console.error("devgym MCP server running on stdio");

const shutdown = () => {
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
