// The background worker started by the session hook. It reads the developer's new commits, a batch of older ones,
// and the fix commits, so Grow stays current without anyone running a command. Rules only: no AI, no output.
import { growStatus } from "../grow/status.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";

async function main(): Promise<void> {
  const root = process.argv[3];
  if (!root) return;
  const db = openDb();
  try {
    migrate(db);
    await growStatus(db, { root });
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`devgym background: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
