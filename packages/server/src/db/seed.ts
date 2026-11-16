import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTicketMarkdown } from "../tickets/markdown.js";
import { transaction, type Db } from "./connection.js";

/** Demo tickets that ship inside the plugin. Works from both src/db and dist/db. */
export function defaultTicketsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "demo-tickets");
}

/** Loads every .md ticket in the folder. Safe to run many times. Returns the ticket ids. */
export function seed(db: Db, ticketsDir: string = defaultTicketsDir()): string[] {
  const upsert = db.prepare(`
    INSERT INTO tickets (id, title, body, source) VALUES (@id, @title, @body, 'markdown')
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body, source = excluded.source
  `);
  const files = readdirSync(ticketsDir).filter((f) => f.endsWith(".md")).sort();
  const ids: string[] = [];
  transaction(db, () => {
    for (const file of files) {
      const ticket = parseTicketMarkdown(readFileSync(join(ticketsDir, file), "utf8"));
      upsert.run({ id: ticket.id, title: ticket.title, body: ticket.body });
      ids.push(ticket.id);
    }
  });
  return ids;
}
