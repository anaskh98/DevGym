import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { PrivacyGuard } from "../privacy/guard.js";
import { API_HOST, createApiServer, DEFAULT_API_PORT, listen } from "./server.js";
import { reportPath } from "./static.js";

const db = openDb();
migrate(db);

const port = Number(process.env.DEVGYM_PORT ?? DEFAULT_API_PORT);
// The web app dev server (port 4318) is allowed by default so the frontend can develop against real data.
const allowedOrigins = (process.env.DEVGYM_WEB_ORIGIN ?? "http://127.0.0.1:4318,http://localhost:4318")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// The built web app ships in "web" next to this file's folder, when the plugin includes it.
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

const server = createApiServer({ db, guard: new PrivacyGuard({ root: process.cwd() }), allowedOrigins, webDir, growRoot: process.cwd() });
try {
  const actual = await listen(server, port);
  console.log(`devgym API listening on http://${API_HOST}:${actual}/api`);
  console.log(`Grow report: http://${API_HOST}:${actual}${reportPath(webDir)}`);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(code === "EADDRINUSE" ? `Port ${port} is already in use. Set DEVGYM_PORT to another port.` : err);
  db.close();
  process.exit(1);
}

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
