/**
 * Reads tickets from Markdown files in one directory:
 *
 *   ---
 *   id: DEMO-1
 *   title: Let members cancel a booking
 *   ---
 *   The ticket body, in Markdown.
 *
 * Without front matter, the id is the file name and the title is the first
 * "# heading".
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { isValidTicketId, type SourceTicket, type TicketSource } from "./source";

interface Parsed {
  meta: Record<string, string>;
  body: string;
}

export function parseFrontMatter(raw: string): Parsed {
  const text = raw.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };

  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1] as string;
    const value = (pair[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
    meta[key.toLowerCase()] = value;
  }
  return { meta, body: text.slice(match[0].length).trim() };
}

export function parseTicketFile(fileName: string, raw: string): SourceTicket {
  const { meta, body } = parseFrontMatter(raw);
  const heading = /^#\s+(.+)$/m.exec(body);
  const id = meta.id || basename(fileName, ".md");
  return {
    id,
    title: meta.title || heading?.[1]?.trim() || id,
    body,
  };
}

export class MarkdownTicketSource implements TicketSource {
  readonly name = "markdown";

  constructor(private readonly dir: string) {}

  async list(): Promise<SourceTicket[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const tickets: SourceTicket[] = [];
    for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
      const ticket = parseTicketFile(name, await readFile(join(this.dir, name), "utf8"));
      if (isValidTicketId(ticket.id)) tickets.push(ticket);
    }
    return tickets;
  }

  async get(id: string): Promise<SourceTicket | null> {
    if (!isValidTicketId(id)) return null;
    const wanted = id.toLowerCase();
    // Match on the id in the front matter (or file name), not on a path built
    // from input, so an id can never reach outside the tickets directory.
    return (await this.list()).find((ticket) => ticket.id.toLowerCase() === wanted) ?? null;
  }
}
