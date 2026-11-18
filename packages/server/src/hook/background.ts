// The background worker started by the session hook. It reads the developer's new commits, a batch of older ones,
// and the fix commits, so Coach stays current without anyone running a command. Rules only: no AI, no output.
import { coachStatus } from "../coach/status.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";

async function main(): Promise<void> {
  const root = process.argv[3];
  if (!root) return;
  const db = openDb();
  try {
    migrate(db);
    await coachStatus(db, { root });
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`fork-trail-coach background: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
