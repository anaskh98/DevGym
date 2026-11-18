// Builds a made-up profile through the real store, then saves what the real REST API answers for it.
//
//   node dist/demo/sample.js <out-dir>
//
// The web app shows these files in mock mode (packages/web/public/mock), so its sample data always has
// exactly the shapes the service sends. Nothing here touches the developer's own profile.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createApiServer, listen } from "../api/server.js";
import * as data from "../api/data.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { PrivacyGuard } from "../privacy/guard.js";
import * as store from "../store.js";
import { SAMPLE_EVAL } from "./sample-eval.js";

const TICKET = "SAMPLE-1";
const SESSION = "sess-sample-1";
const REPO = "example-org/shop";
const COMMIT = "4f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a39";

export function buildSampleProfile(dbPath: string, repoRoot: string): void {
  const db = openDb(dbPath);
  migrate(db);
  try {
    store.upsertTicket(db, {
      id: TICKET,
      title: "Let customers export their order history",
      source: "markdown",
      body: [
        "Customers keep asking support for a list of their past orders.",
        "Add a way for a customer to export their order history.",
        "",
        "- The export should include recent orders.",
        "- Large exports should not slow the service down.",
        "- Cancelled orders are handled as usual.",
        "- Only the right people can export.",
      ].join("\n"),
    });
    store.saveAssumptions(db, {
      ticket_id: TICKET,
      assumptions: [
        { text: "How far back do recent orders go?", status: "answered_by_po", answer: "The last 90 days." },
        { text: "Are cancelled orders in the export?", status: "answered_by_po", answer: "Yes, with their status, so support can match them." },
        { text: "Who counts as the right people to export?", status: "assumed_by_dev", answer: "Assuming: the customer, for their own orders only." },
        { text: "What happens when an export is very large?", status: "assumed_by_dev", answer: "Assuming: it is streamed in pages, in the same request." },
      ],
    });
    store.startTrail(db, { ticket_id: TICKET, session_id: SESSION });
    for (const file of ["src/orders/export.ts", "src/orders/export.test.ts", "src/routes/orders.ts", "src/orders/csv.ts", "README.md"]) {
      store.recordFileEdit(db, SESSION, file);
    }
    const decide = (input: Omit<Parameters<typeof store.logDecision>[1], "ticket_id" | "session_id" | "related_files"> & { related_files?: string[] }) =>
      store.logDecision(db, { ticket_id: TICKET, session_id: SESSION, related_files: [], ...input }, repoRoot).decision_id;
    const pages = decide({
      summary: "Stream the export one page of orders at a time, so memory stays flat however many orders match.",
      alternatives: ["Load every order, then write the file."],
      origin: "ai",
      pointer: { repo: REPO, file_path: "src/orders/export.ts", symbol: "exportOrders", line_hint: 14, commit: COMMIT },
      related_files: ["src/orders/export.test.ts"],
    });
    const window = decide({
      summary: "Measure the 90 days from the start of today in UTC, so the same request always returns the same orders.",
      alternatives: ["Measure from the exact moment of the request."],
      origin: "dev",
      pointer: { repo: REPO, file_path: "src/orders/export.ts", symbol: "recentOrdersSince", line_hint: 41, commit: COMMIT },
    });
    const amounts = decide({
      summary: "Write amounts as decimals with a currency column. Claude proposed the stored minor units; the developer changed it for spreadsheets.",
      alternatives: ["Minor units, exactly as stored."],
      origin: "dev_changed_ai",
      pointer: { repo: REPO, file_path: "src/orders/csv.ts", symbol: "toCsvRow", line_hint: 9, commit: COMMIT },
    });
    const access = decide({
      summary: "Reuse the order-history permission check before exporting, instead of adding a new permission.",
      alternatives: ["Add a separate export permission."],
      origin: "ai",
      pointer: { repo: REPO, file_path: "src/routes/orders.ts", symbol: "exportRoute", line_hint: 22, commit: COMMIT },
    });
    // One pointer that a later check could not find, to show the broken state.
    db.prepare("UPDATE pointers SET resolved = 1, resolved_at = datetime('now')").run();
    db.prepare(
      "UPDATE pointers SET resolved = 0, resolve_note = 'exportRoute is not in src/routes/orders.ts at this commit' WHERE symbol = 'exportRoute'",
    ).run();

    const e1 = store.recordExplainBack(db, {
      decision_id: pages,
      question: "Why stream the export in pages instead of building it first?",
      answer: "Memory stays the same however many orders match, and the download starts at once.",
      rating: "clear",
    }).explain_back_id;
    const e2 = store.recordExplainBack(db, {
      decision_id: amounts,
      question: "Why did you change the amounts from minor units to decimals?",
      answer: "Support opens the file in a spreadsheet. I did not check how the other exports write amounts.",
      rating: "partial",
    }).explain_back_id;
    const e3 = store.recordExplainBack(db, {
      decision_id: access,
      question: "Which customers can the reused permission check let through?",
      answer: "I am not sure. Claude picked it and the tests passed.",
      rating: "not_yet",
    }).explain_back_id;

    const o1 = store.saveObservation(db, {
      skill_tag: "performance",
      summary: "Explains clearly why paging keeps memory flat when the result size is not bounded.",
      evidence_ids: [pages, e1],
    }).observation_id;
    const o2 = store.saveObservation(db, {
      skill_tag: "reviewing-ai-code",
      summary: "Kept an access check Claude chose without being able to say who it lets through.",
      evidence_ids: [access, e3],
    }).observation_id;
    const o3 = store.saveObservation(db, {
      skill_tag: "reviewing-ai-code",
      summary: "Accepted the date window rule without writing down why UTC was chosen.",
      evidence_ids: [window],
    }).observation_id;
    const o4 = store.saveObservation(db, {
      skill_tag: "codebase-consistency",
      summary: "Chose a number format for the reader without checking how other exports write it.",
      evidence_ids: [amounts, e2],
    }).observation_id;

    const plan = store.saveGrowthPlan(db, {
      focus_areas: [
        {
          claim: "Accepts access rules from Claude without being able to say who they let through.",
          evidence_ids: [o2, o3],
          exercise: "Before accepting the next permission check, list two users it allows and one it refuses, then ask Claude to confirm.",
        },
        {
          claim: "Chooses output formats without checking how the rest of the codebase does it.",
          evidence_ids: [o4],
          exercise: "Before the next change to an output format, find two other places that write the same kind of value.",
        },
        {
          claim: "Reasons well about memory on results of unknown size.",
          evidence_ids: [o1],
          exercise: "Add a test that exports 100,000 orders and checks that memory stays flat.",
        },
      ],
    });
    data.addAnnotation(db, {
      target_id: plan.focus_areas[1]!.id,
      note: "I checked afterwards: the invoice export writes decimals too, so this one matches.",
      disagrees: true,
    });
  } finally {
    db.close();
  }
}

/** Saves what each API route answers for the sample profile, as public/mock/<path>.json. */
export async function writeMocks(outDir: string): Promise<string[]> {
  const work = mkdtempSync(join(tmpdir(), "devgym-sample-"));
  const dbPath = join(work, "profile.sqlite");
  const evalFile = join(work, "eval-results.json");
  writeFileSync(evalFile, JSON.stringify(SAMPLE_EVAL, null, 2));
  buildSampleProfile(dbPath, work);

  const db = openDb(dbPath);
  const server = createApiServer({ db, guard: new PrivacyGuard({ root: work, denylist: () => [] }), evalFile });
  const port = await listen(server, 0);
  const written: string[] = [];
  try {
    const save = async (path: string) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      if (!response.ok) throw new Error(`${path} answered ${response.status}`);
      const file = join(outDir, `${path}.json`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify(await response.json(), null, 2)}\n`);
      written.push(file);
    };
    for (const path of ["/api/tickets", `/api/tickets/${TICKET}`, "/api/growth-plan", "/api/export", "/api/eval"]) await save(path);
  } finally {
    await new Promise((done) => server.close(done));
    db.close();
    rmSync(work, { recursive: true, force: true });
  }
  return written;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const out = process.argv[2];
  if (!out) {
    console.error("Usage: node dist/demo/sample.js <out-dir>");
    process.exit(1);
  }
  for (const file of await writeMocks(resolve(out))) console.log(`wrote ${file}`);
}
