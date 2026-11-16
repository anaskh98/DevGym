import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { PrivacyGuard } from "../privacy/guard.js";
import { API_HOST, createApiServer, DEFAULT_API_PORT, listen } from "./server.js";

const db = openDb();
migrate(db);

const port = Number(process.env.FTC_PORT ?? DEFAULT_API_PORT);
// The web app dev server (port 4318) is allowed by default so the frontend can develop against real data.
const allowedOrigins = (process.env.FTC_WEB_ORIGIN ?? "http://127.0.0.1:4318,http://localhost:4318")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const server = createApiServer({ db, guard: new PrivacyGuard({ root: process.cwd() }), allowedOrigins });
try {
  const actual = await listen(server, port);
  console.log(`fork-trail-coach API listening on http://${API_HOST}:${actual}/api`);
} catch (err) {
  const code = (err as NodeJS.ErrnoException).code;
  console.error(code === "EADDRINUSE" ? `Port ${port} is already in use. Set FTC_PORT to another port.` : err);
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
