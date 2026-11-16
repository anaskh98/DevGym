import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TicketAdapter, TicketData } from "./adapter.js";

/**
 * Reads a ticket from Markdown with a small front matter block:
 *   ---
 *   id: SAMPLE-1
 *   title: Some title
 *   ---
 *   Body text...
 */
export function parseTicketMarkdown(text: string): TicketData {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ""));
  if (!match) throw new Error("Ticket file has no front matter block");
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.title) throw new Error("Ticket file needs 'id' and 'title'");
  return { id: meta.id, title: meta.title, body: (match[2] ?? "").trim() };
}

/**
 * Finds tickets in one or more folders of .md files. Earlier folders win.
 * The id is matched against each file's front matter, never used to build a path,
 * so an id like "../secret" cannot read files outside the folders.
 */
export class MarkdownTicketAdapter implements TicketAdapter {
  readonly source = "markdown";

  constructor(private readonly dirs: string[]) {}

  async getTicket(id: string): Promise<TicketData | null> {
    for (const dir of this.dirs) {
      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
      } catch {
        continue; // A missing folder just has no tickets.
      }
      for (const file of files) {
        try {
          const ticket = parseTicketMarkdown(await readFile(join(dir, file), "utf8"));
          if (ticket.id === id) return ticket;
        } catch {
          // Not a ticket file (a README, for example). Skip it.
        }
      }
    }
    return null;
  }
}
