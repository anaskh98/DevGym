/** pnpm db:migrate — create or update the local SQLite file. */
import { loadConfig } from "../config";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { DATA_TABLES } from "../db/migrations";

const config = loadConfig();
const db = openDb(config.dbPath);
const applied = migrate(db);

console.log(`database: ${config.dbPath}`);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "already up to date");
for (const table of DATA_TABLES) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  console.log(`  ${table.padEnd(14)} ${Number(row?.n ?? 0)} rows`);
}
db.close();
