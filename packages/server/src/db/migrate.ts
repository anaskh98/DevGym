import { transaction, type Db } from "./connection";
import { MIGRATIONS, type Migration } from "./migrations";

/** Applies every migration that has not run yet. Returns the names applied. */
export function migrate(db: Db, migrations: Migration[] = MIGRATIONS): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    );
  `);

  const done = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => Number(row.id)),
  );

  const applied: string[] = [];
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (done.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
    });
    applied.push(migration.name);
  }
  return applied;
}
