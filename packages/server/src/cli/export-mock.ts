/**
 * pnpm db:export-mock — write your local store as the JSON files the web app
 * reads in mock mode, in the same shapes the REST API (BE-12) will return.
 * Until BE-12 exists, this is how the web app shows a real /ftc:fork result.
 *
 *   --out <dir>   Default: packages/web/public/mock-local (ignored by git)
 *
 * Then: VITE_MOCK_DIR=mock-local pnpm dev:web
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  API_PATHS,
  type ForkResultResponse,
  type TicketListResponse,
} from "@ftc/shared";
import { loadConfig } from "../config";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { Store } from "../db/store";
import { PendingGuard } from "../privacy/guard";
import { flag, WEB_MOCK_LOCAL_DIR } from "./shared";

export async function exportMock(store: Store, outDir: string): Promise<string[]> {
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
    const result: ForkResultResponse = {
      ticket: store.requireTicket(summary.id),
      runs: store.listForkRuns(summary.id),
    };
    await write(API_PATHS.forkResult(summary.id), result);
  }
  return written;
}

const isMain = process.argv[1]?.endsWith("export-mock.ts");
if (isMain) {
  const config = loadConfig();
  const db = openDb(config.dbPath);
  migrate(db);
  const store = new Store(db, { guard: new PendingGuard() });
  const files = await exportMock(store, flag("out") ?? WEB_MOCK_LOCAL_DIR);
  for (const file of files) console.log(`wrote ${file}`);
  console.log("\nView it: VITE_MOCK_DIR=mock-local pnpm dev:web");
  db.close();
}
