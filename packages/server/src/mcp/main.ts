/**
 * Entry point for the stdio MCP server. Claude Code starts this through the
 * plugin's .mcp.json. stdout carries the protocol, so logs go to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "../config";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { Store } from "../db/store";
import { PendingGuard } from "../privacy/guard";
import { MarkdownTicketSource } from "../tickets/markdown";
import { createFtcServer, SERVER_NAME, SERVER_VERSION } from "./server";

function log(message: string): void {
  process.stderr.write(`[ftc] ${message}\n`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const applied = migrate(db);
  const guard = new PendingGuard();
  const store = new Store(db, { guard });
  const tickets = new MarkdownTicketSource(config.ticketsDir);

  const server = createFtcServer({ store, tickets, config });
  await server.connect(new StdioServerTransport());

  log(`${SERVER_NAME} ${SERVER_VERSION} ready`);
  log(`database: ${config.dbPath}${applied.length ? ` (migrated: ${applied.join(", ")})` : ""}`);
  log(`tickets:  ${config.ticketsDir}`);
  log(`privacy guard: ${guard.name}`);

  const shutdown = () => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exit(1);
});
