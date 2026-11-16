import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTicketsDir } from "../db/seed.js";
import { MarkdownTicketAdapter } from "./markdown.js";

let root: string;
let a: string;
let b: string;
const ticket = (id: string, title: string) => `---\nid: ${id}\ntitle: ${title}\n---\nBody of ${id}`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ftc-tickets-"));
  a = mkdtempSync(join(root, "a-"));
  b = mkdtempSync(join(root, "b-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("MarkdownTicketAdapter", () => {
  it("reads the demo ticket that ships with the plugin", async () => {
    const adapter = new MarkdownTicketAdapter([defaultTicketsDir()]);
    const found = await adapter.getTicket("SAMPLE-1");
    expect(found?.title).toBe("Let customers export their order history");
    expect(found?.body).toContain("order history");
    expect(adapter.source).toBe("markdown");
  });

  it("finds a ticket by its front matter id, whatever the file is called", async () => {
    writeFileSync(join(a, "some-file-name.md"), ticket("X-7", "Seven"));
    const adapter = new MarkdownTicketAdapter([a]);
    expect(await adapter.getTicket("X-7")).toEqual({ id: "X-7", title: "Seven", body: "Body of X-7" });
  });

  it("returns null for an unknown id and for a missing folder", async () => {
    writeFileSync(join(a, "x.md"), ticket("X-1", "One"));
    expect(await new MarkdownTicketAdapter([a]).getTicket("X-2")).toBeNull();
    expect(await new MarkdownTicketAdapter([join(root, "nope")]).getTicket("X-1")).toBeNull();
    expect(await new MarkdownTicketAdapter([]).getTicket("X-1")).toBeNull();
  });

  it("lets an earlier folder win", async () => {
    writeFileSync(join(a, "x.md"), ticket("X-1", "From project"));
    writeFileSync(join(b, "x.md"), ticket("X-1", "From demo"));
    writeFileSync(join(b, "y.md"), ticket("Y-1", "Only in demo"));
    const adapter = new MarkdownTicketAdapter([a, b]);
    expect((await adapter.getTicket("X-1"))?.title).toBe("From project");
    expect((await adapter.getTicket("Y-1"))?.title).toBe("Only in demo");
  });

  it("skips files that are not tickets", async () => {
    writeFileSync(join(a, "README.md"), "# Just notes");
    writeFileSync(join(a, "notes.txt"), ticket("X-1", "Wrong extension"));
    writeFileSync(join(a, "x.md"), ticket("X-2", "Two"));
    const adapter = new MarkdownTicketAdapter([a]);
    expect(await adapter.getTicket("X-1")).toBeNull();
    expect((await adapter.getTicket("X-2"))?.title).toBe("Two");
  });

  it("cannot be tricked into reading outside its folders", async () => {
    writeFileSync(join(root, "secret.md"), ticket("SECRET", "Outside"));
    const adapter = new MarkdownTicketAdapter([a]);
    expect(await adapter.getTicket("../secret")).toBeNull();
    expect(await adapter.getTicket("SECRET")).toBeNull();
  });
});
