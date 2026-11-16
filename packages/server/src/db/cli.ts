import { defaultDbPath, openDb } from "./connection.js";
import { migrate } from "./migrations.js";
import { seed } from "./seed.js";

const command = process.argv[2];
const db = openDb();
try {
  if (command === "migrate") {
    const applied = migrate(db);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Already up to date");
  } else if (command === "seed") {
    migrate(db);
    console.log(`Seeded tickets: ${seed(db).join(", ")}`);
  } else if (command === "status") {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    console.log(`Database: ${defaultDbPath()}`);
    for (const t of tables) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM "${t}"`).get() as { n: number };
      console.log(`  ${t}: ${n} rows`);
    }
  } else {
    console.error("Usage: cli <migrate|seed|status>");
    process.exitCode = 1;
  }
} finally {
  db.close();
}
