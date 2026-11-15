import { describe, expect, it } from "vitest";
import { MarkdownTicketSource, parseFrontMatter, parseTicketFile } from "../src/tickets/markdown";
import { isValidTicketId, type TicketSource } from "../src/tickets/source";
import { ticketsDir } from "./helpers";

describe("Markdown ticket adapter (BE-4)", () => {
  it("reads id and title from front matter", () => {
    const ticket = parseTicketFile(
      "whatever.md",
      '---\nid: DEMO-1\ntitle: "Let members cancel"\n---\n\n## Why\n\nBecause.\n',
    );
    expect(ticket).toEqual({ id: "DEMO-1", title: "Let members cancel", body: "## Why\n\nBecause." });
  });

  it("falls back to the file name and first heading", () => {
    expect(parseTicketFile("BUG-9.md", "# Fix the thing\n\nDetails.")).toEqual({
      id: "BUG-9",
      title: "Fix the thing",
      body: "# Fix the thing\n\nDetails.",
    });
  });

  it("handles Windows line endings and a BOM", () => {
    const { meta, body } = parseFrontMatter("﻿---\r\nid: X-1\r\n---\r\nBody\r\n");
    expect(meta.id).toBe("X-1");
    expect(body).toBe("Body");
  });

  it("finds a ticket by id, whatever the case or file name", async () => {
    const source = new MarkdownTicketSource(
      await ticketsDir({
        "first.md": "---\nid: DEMO-1\ntitle: One\n---\nBody one",
        "DEMO-2.md": "# Two\nBody two",
        "notes.txt": "not a ticket",
      }),
    );
    expect((await source.get("demo-1"))?.title).toBe("One");
    expect((await source.get("DEMO-2"))?.title).toBe("Two");
    expect(await source.get("DEMO-3")).toBeNull();
    expect((await source.list()).map((t) => t.id)).toEqual(["DEMO-2", "DEMO-1"]);
  });

  it("never reads outside the tickets folder", async () => {
    const source = new MarkdownTicketSource(await ticketsDir({ "A-1.md": "# A" }));
    for (const id of ["../A-1", "..", "a/b", "/etc/passwd", "A-1.md/../..", ""]) {
      expect(isValidTicketId(id), id).toBe(false);
      expect(await source.get(id), id).toBeNull();
    }
  });

  it("returns no tickets when the folder is missing", async () => {
    const source = new MarkdownTicketSource("/nonexistent/ftc/tickets");
    expect(await source.list()).toEqual([]);
    expect(await source.get("DEMO-1")).toBeNull();
  });

  it("is an interface another source (Jira) can implement", async () => {
    const jira: TicketSource = {
      name: "jira",
      get: async (id) => ({ id, title: "From Jira", body: "..." }),
      list: async () => [],
    };
    expect((await jira.get("PROJ-1"))?.title).toBe("From Jira");
  });
});
