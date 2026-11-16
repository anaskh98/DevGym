import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrivacyError } from "../errors.js";
import { containsBlockedName, loadDenylist } from "./denylist.js";
import { PrivacyGuard } from "./guard.js";
import { RepoCodeIndex } from "./overlap.js";
import { findRuleHit } from "./rules.js";

const NAMES = ["Acme Corp", "Globex", "Initech Ltd", "QX"];

const REPO_FILE = `import { Order } from "./types";

export function exportOrders(orders: Order[], since: Date): string {
  const rows = orders.filter((order) => order.createdAt >= since && order.status !== "cancelled");
  const header = ["id", "created_at", "total", "currency"].join(",");
  return [header, ...rows.map((order) => toCsvRow(order))].join("\\n");
}
`;

let repo: string;
let guard: PrivacyGuard;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "ftc-guard-"));
  mkdirSync(join(repo, "src"));
  mkdirSync(join(repo, "node_modules", "lib"), { recursive: true });
  writeFileSync(join(repo, "src", "export.ts"), REPO_FILE);
  writeFileSync(join(repo, "README.md"), "The export should include recent orders, and it is sorted by date (newest first).");
  writeFileSync(join(repo, "node_modules", "lib", "index.js"), "module.exports = { vendored: true, answer: 42, name: 'lib' };");
  guard = new PrivacyGuard({ root: repo, denylist: () => NAMES });
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

/** Returns the rule that rejected the input, or null when it was accepted. */
function rejectedBy(input: unknown): string | null {
  try {
    guard.check(input);
    return null;
  } catch (err) {
    if (err instanceof PrivacyError) return err.rule;
    throw err;
  }
}

// Text the tools really produce. All of it must pass: a guard that blocks honest prose gets switched off.
const HONEST = [
  "Export format is CSV, with a header row, cells quoted only when they hold commas, quotes or newlines, and totals shown as decimal amounts with a separate currency column. CSV opens in spreadsheets and needs no dependency.",
  'Cancelled orders are left out of the export. The ticket says "handled as usual", which was read as meaning they are not shown as real orders.',
  "Stream the export in pages of 500 rows; building the whole file in memory would not scale.",
  "Put the date filter in exportOrders() and not in the route handler, so the background job can reuse it.",
  "Assuming: built in the background, with an email link to download when ready.",
  "Why stream the export instead of loading it all?",
  "Use a Map keyed by order id for the lookup (O(1)) and not a nested loop.",
  "Chose zod over hand-written checks: one schema gives both validation and types.",
  "The customer selects a date range from the account page, and the export covers only that range.",
  "Return a 403 when a customer asks for another customer's orders; do not reveal whether the order exists.",
  "Retry the upload up to 3 times with a growing delay (1s, 2s, 4s), then mark the export as failed.",
  "Could explain trade-offs more: pick one decision per ticket and write two alternatives before coding.",
  "Token: the session token is checked on every request, not only at login.",
  "JSON array",
  "Leave cancelled orders out of the export",
];

// [what the attacker tries, the text]
const RED_TEAM_CODE: [string, string][] = [
  ["fenced code block", "Chose this:\n```ts\nexportOrders(orders)\n```"],
  ["variable declaration", "I used const rows = orders.filter(isRecent) to pick the rows"],
  ["typed declaration", "let total: number = order.amount * 100"],
  ["function definition", "function exportOrders(orders) { return orders.map(toRow) }"],
  ["arrow function", "The filter is (order) => order.status !== 'cancelled' which is simple"],
  ["import line", "Added import { stringify } from 'csv-stringify' at the top"],
  ["require call", "It loads the lib with require('csv-stringify') lazily"],
  ["python function", "def export_orders(orders, since):\n    return [o for o in orders if o.created >= since]"],
  ["class definition", "class OrderExporter extends BaseExporter { run() {} }"],
  ["if block", "Guard clause: if (!user.canExport) { throw new ForbiddenError() }"],
  ["return statement", "The function ends with return rows.join(delimiter); and nothing else"],
  ["call statement", "First it runs validate(input); and then it continues"],
  ["assignment statement", "Then total += order.amount * rate; for every order"],
  ["method chain", "orders.filter(isRecent).map(toRow).join(newline) is the whole pipeline"],
  ["object literal", "Config is { pageSize: 500, format: 'csv', retries: 3 } for now"],
  ["JSX markup", "Renders <ExportButton onClick={start} disabled={busy} /> in the header"],
  ["HTML markup", "The page shows <div class=\"export\">Download</div> at the top"],
  ["SQL query", "It runs select id, total from orders where customer_id = 7 to get rows"],
  ["SQL insert", "Then INSERT INTO exports (id, status) VALUES (1, 'done')"],
  ["base64 blob", "See ZnVuY3Rpb24gZXhwb3J0T3JkZXJzKG9yZGVycykgeyByZXR1cm4gb3JkZXJzLm1hcCh0b1Jvdyk7IH0gLy8gZW5jb2RlZCBzbyB0aGUgZ3VhcmQgbWlzc2VzIGl0"],
  ["code with odd keywords", "foo(bar[0], baz[1]) || qux({a}) && (x[i] = y[j]) <= z(k)(m)[n]"],
  ["zero-width chars in keyword", "I used con​st rows = orders.filter(isRecent) here"],
  ["fullwidth characters", "ｃｏｎｓｔ rows ＝ orders.filter(isRecent)"],
  ["multi-line paste, no keywords", "rows:\n  filter(orders, recent),\n  sort(rows, byDate),\n  write(rows, out)\n"],
];

const RED_TEAM_SECRETS: [string, string][] = [
  ["AWS key", "The job uses key AKIAIOSFODNN7EXAMPLE to upload"],
  ["GitHub token", "Auth with ghp_abcdefghijklmnopqrstuvwxyz0123456789 for the API"],
  ["private key", "-----BEGIN RSA PRIVATE KEY-----\nMIIEow"],
  ["password assignment", "Connect with password=Hunter2secret on staging"],
  ["api key assignment", "Set api_key: 'k9f83hf93hf93h' in the config"],
  ["connection string", "The database is at postgres://admin:s3cretpw@db.internal:5432/orders"],
  ["JWT", "Token was eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV"],
];

const RED_TEAM_NAMES: [string, string][] = [
  ["plain name", "This matches how Acme Corp wants exports"],
  ["different case", "ACME CORP asked for CSV"],
  ["no space", "The acmecorp tenant needs 90 days"],
  ["dash and suffix", "For the Acme-Corp-EU deployment"],
  ["spaced out letters", "client is A c m e   C o r p"],
  ["dots between letters", "client is a.c.m.e.c.o.r.p"],
  ["digits for letters", "the 4cm3 c0rp account"],
  ["accented letters", "Ácmé Çorp requested it"],
  ["Cyrillic look-alikes", "Асmе Соrр requested it"],
  ["zero-width chars", "Ac​me Co​rp requested it"],
  ["inside an identifier", "see GlobexBillingAdapter for details"],
  ["second name", "initech ltd has a different limit"],
  ["short name standing alone", "the QX rollout comes first"],
];

describe("honest text", () => {
  it.each(HONEST)("accepts: %s", (text) => {
    expect(rejectedBy({ summary: text })).toBeNull();
  });

  it("does not treat a short name inside a word as a hit", () => {
    expect(rejectedBy({ summary: "The QXL format and the aqx prefix are fine" })).toBeNull();
  });

  it("accepts prose that happens to match a README sentence", () => {
    expect(rejectedBy({ summary: "The export should include recent orders, and it is sorted by date (newest first)." })).toBeNull();
  });
});

describe("red team: code patterns", () => {
  it.each(RED_TEAM_CODE)("rejects %s", (_label, text) => {
    expect(findRuleHit(text)?.kind).toBe("code");
    expect(rejectedBy({ summary: text })).not.toBeNull();
  });
});

describe("red team: secrets", () => {
  it.each(RED_TEAM_SECRETS)("rejects %s", (_label, text) => {
    expect(findRuleHit(text)?.kind).toBe("secret");
  });
});

describe("red team: client names", () => {
  it.each(RED_TEAM_NAMES)("rejects %s", (_label, text) => {
    expect(containsBlockedName(text, NAMES)).toBe(true);
    expect(rejectedBy({ summary: text })).toBe("client-name");
  });

  it("rejects a client name in ids, paths and symbols too", () => {
    expect(rejectedBy({ ticket_id: "ACMECORP-123" })).toBe("client-name");
    expect(rejectedBy({ pointer: { repo: "team/demo", file_path: "src/clients/acme-corp/export.ts" } })).toBe("client-name");
    expect(rejectedBy({ pointer: { repo: "team/demo", file_path: "src/a.ts", symbol: "globexExport" } })).toBe("client-name");
    expect(rejectedBy({ related_files: ["src/ok.ts", "src/initech_ltd.ts"] })).toBe("client-name");
  });

  it("rejects a ticket that names a client", () => {
    expect(() => guard.checkTicket({ id: "T-1", title: "Export for Globex", body: "b" })).toThrow(/ticket\.title.*client denylist/);
    expect(() => guard.checkTicket({ id: "T-1", title: "Export", body: "function f() { return 1; }" })).not.toThrow();
  });

  it("answers path checks for the edit hook", () => {
    expect(guard.pathAllowed("src/export.ts")).toBe(true);
    expect(guard.pathAllowed("src/acme_corp/export.ts")).toBe(false);
  });
});

describe("red team: copying code from the repo", () => {
  const index = () => new RepoCodeIndex(repo);

  it("rejects a line copied word for word", () => {
    expect(rejectedBy({ answer: 'I wrote header = ["id", "created_at", "total", "currency"] to fix the columns' })).not.toBeNull();
    expect(index().overlaps('header = ["id", "created_at", "total", "currency"]')).toBe(true);
  });

  it("still catches the copy when spacing and line breaks change", () => {
    expect(index().overlaps("orders . filter( ( order )\n=>\norder . createdAt   >= since")).toBe(true);
  });

  it("catches a copied fragment that no pattern rule matches", () => {
    const fragment = "order.createdAt >= since && order.status";
    expect(findRuleHit(fragment)).toBeNull();
    expect(rejectedBy({ summary: `The key part is ${fragment} as the test` })).toBe("code-overlap");
  });

  it("allows naming a function or a file from the repo", () => {
    expect(rejectedBy({ summary: "The filter lives in exportOrders in src/export.ts, next to toCsvRow." })).toBeNull();
  });

  it("allows repeating words that sit inside a string in the code", () => {
    writeFileSync(join(repo, "src", "messages.ts"), `export const TOO_BIG = "The export is too large (over 10,000 rows); narrow the date range.";\n`);
    const fresh = new PrivacyGuard({ root: repo, denylist: () => NAMES });
    expect(() => fresh.check({ summary: "Show the message: The export is too large (over 10,000 rows); narrow the date range." })).not.toThrow();
  });

  it("ignores node_modules and non-code files", () => {
    expect(index().overlaps("module.exports = { vendored: true, answer: 42, name: 'lib' };")).toBe(false);
  });

  it("picks up code written after the first check", () => {
    let now = 1_000_000;
    const live = new RepoCodeIndex(repo, () => now);
    const line = "if (attempt > maxAttempts) throw new ExportFailed(exportId, attempt);";
    expect(live.overlaps(line)).toBe(false);
    writeFileSync(join(repo, "src", "retry.ts"), `export function check(attempt: number) {\n  ${line}\n}\n`);
    expect(live.overlaps(line)).toBe(false); // still inside the refresh window
    now += 31_000;
    expect(live.overlaps(line)).toBe(true);
  });
});

describe("guard.check", () => {
  it("checks every free-text field, however deep, and names the field", () => {
    const code = "const x = load(path)";
    const fields: [unknown, string][] = [
      [{ summary: code }, "summary"],
      [{ summary: "ok", alternatives: ["fine", code] }, "alternatives[1]"],
      [{ assumptions: [{ text: "ok", status: "assumed_by_dev", answer: code }] }, "assumptions[0].answer"],
      [{ focus_areas: [{ claim: "ok", evidence_ids: ["o1"], exercise: code }] }, "focus_areas[0].exercise"],
      [{ question: code }, "question"],
      [{ some_future_field: { nested: code } }, "some_future_field.nested"],
    ];
    for (const [input, field] of fields) {
      try {
        guard.check(input);
        throw new Error(`accepted ${field}`);
      } catch (err) {
        expect(err).toBeInstanceOf(PrivacyError);
        expect((err as PrivacyError).field).toBe(field);
      }
    }
  });

  it("gives a reason without repeating the blocked text", () => {
    try {
      guard.check({ summary: "For Globex: const secretSauce = 42" });
      throw new Error("accepted");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toMatch(/privacy guard.*'summary'.*client denylist.*Nothing was saved/);
      expect(message).not.toMatch(/Globex|secretSauce/i);
    }
  });

  it("does not run code rules on paths, symbols and ids", () => {
    expect(
      rejectedBy({
        ticket_id: "SAMPLE-1",
        session_id: "22e0ca46-13df-4228-ac63-b57e628aa0c3",
        pointer: { repo: "team/demo", file_path: "src/[id]/(group)/page.tsx", symbol: "Exporter.run", commit: "a".repeat(40) },
        related_files: ["src/a=b;c.ts"],
        evidence_ids: ["f".repeat(64)],
      }),
    ).toBeNull();
  });
});

describe("loadDenylist", () => {
  it("reads names from a file, skipping comments and blank lines", () => {
    const file = join(repo, "denylist.txt");
    writeFileSync(file, "# clients\nAcme Corp\n\n  Globex  \r\n");
    expect(loadDenylist(file)).toEqual(["Acme Corp", "Globex"]);
    expect(loadDenylist(join(repo, "missing.txt"))).toEqual([]);
  });
});
