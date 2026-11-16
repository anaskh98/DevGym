/**
 * pnpm db:export-mock — write your local store as the JSON files the web app
 * reads in mock mode, in the same shapes the REST API (BE-12) will return.
 * Until BE-12 exists, this is how the web app shows real results.
 *
 *   --out <dir>   Default: packages/web/public/mock-local (ignored by git)
 *
 * Then: VITE_MOCK_DIR=mock-local pnpm dev:web
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  API_PATHS,
  EvalResults,
  type CoachReportResponse,
  type ForkResultResponse,
  type MyDataResponse,
  type PaperTrailResponse,
  type TicketListResponse,
} from "@ftc/shared";
import { loadConfig } from "../config";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { Store } from "../db/store";
import { PendingGuard } from "../privacy/guard";
import { EVAL_RESULTS_FILE, flag, WEB_MOCK_LOCAL_DIR } from "./shared";

export interface ExportMeta {
  /** Where the SQLite file is, as shown on the "My data" page. */
  storedIn: string;
  developerId: string;
  exportedAt?: Date;
  /** The eval results to include. Left out when no evaluation has been run. */
  evalResults?: EvalResults;
}

/** Reads the eval results file the harness (EV-3) writes, if there is one. */
export async function readEvalResults(file: string = EVAL_RESULTS_FILE): Promise<EvalResults | undefined> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return EvalResults.parse(JSON.parse(raw));
}

export async function exportMock(store: Store, outDir: string, meta: ExportMeta): Promise<string[]> {
  const written: string[] = [];
  const write = async (apiPath: string, payload: unknown) => {
    const file = join(outDir, `${apiPath}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
    written.push(file);
  };

  const list: TicketListResponse = { tickets: store.listTickets() };
  await write(API_PATHS.tickets(), list);

  for (const summary of list.tickets) {
    const ticket = store.requireTicket(summary.id);
    const fork: ForkResultResponse = { ticket, runs: store.listForkRuns(summary.id) };
    await write(API_PATHS.forkResult(summary.id), fork);

    const trail: PaperTrailResponse = { ticket, decisions: store.listDecisionViews(summary.id) };
    await write(API_PATHS.trail(summary.id), trail);
  }

  const data: MyDataResponse = {
    exported_at: (meta.exportedAt ?? new Date()).toISOString(),
    stored_in: meta.storedIn,
    developer_id: meta.developerId,
    data: store.readAll(),
  };
  await write(API_PATHS.data(), data);

  const coach: CoachReportResponse = store.getCoachReport(meta.developerId);
  await write(API_PATHS.coach(), coach);

  if (meta.evalResults) await write(API_PATHS.eval(), meta.evalResults);

  return written;
}

const isMain = process.argv[1]?.endsWith("export-mock.ts");
if (isMain) {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  migrate(db);
  const store = new Store(db, { guard: new PendingGuard() });
  const files = await exportMock(store, flag("out") ?? WEB_MOCK_LOCAL_DIR, {
    storedIn: config.dbPath,
    developerId: config.developerId,
    evalResults: await readEvalResults(),
  });
  for (const file of files) console.log(`wrote ${file}`);
  console.log("\nView it: VITE_MOCK_DIR=mock-local pnpm dev:web");
  db.close();
}
