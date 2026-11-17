// The eval harness.
//
//   pnpm eval:save-run   Save the demo ticket's current Fork questions as the next run. Do this after each
//                        /fork run: running Fork again replaces the list, so an unsaved run is lost.
//   pnpm eval            Score everything and write the results file the Eval page shows.
//
// Reads the developer's local profile. Writes the results next to it (GET /api/eval serves them).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultEvalResultsPath } from "../api/server.js";
import { openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { scoreFork, type AnswerKey, type ForkRun } from "./fork.js";
import { scorePrivacy } from "./privacy.js";
import type { EvalFailure, EvalResultsFile, EvalScore } from "./results.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "..", "..", "..", "..");
const TICKET = process.env.FTC_EVAL_TICKET ?? "DEMO-1";
const KEY_FILE = join(REPO_ROOT, "packages", "eval", "answer-key", `${TICKET}.json`);
const RUNS_DIR = join(REPO_ROOT, "packages", "eval", "results", "fork-runs", TICKET);
const DEMO_REPO = process.env.FTC_EVAL_REPO ?? join(REPO_ROOT, "demo-repo");

function savedRuns(): ForkRun[] {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((f) => /^run-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as ForkRun)
    .sort((a, b) => a.run - b.run);
}

function saveRun(): void {
  const db = openDb();
  migrate(db);
  const questions = (db.prepare("SELECT text FROM assumptions WHERE ticket_id = ? ORDER BY rowid").all(TICKET) as { text: string }[]).map(
    (r) => r.text,
  );
  db.close();
  if (questions.length === 0) {
    console.error(`No Fork questions saved for ${TICKET}. Run /fork-trail-coach:fork ${TICKET} first.`);
    process.exitCode = 1;
    return;
  }
  const runs = savedRuns();
  const last = runs.at(-1);
  if (last && JSON.stringify(last.questions) === JSON.stringify(questions)) {
    console.error(`These questions are already saved as run ${last.run}. Run Fork again first.`);
    process.exitCode = 1;
    return;
  }
  const run: ForkRun = { run: (last?.run ?? 0) + 1, questions };
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(join(RUNS_DIR, `run-${run.run}.json`), `${JSON.stringify(run, null, 2)}\n`);
  console.log(`Saved run ${run.run} with ${questions.length} questions.`);
}

function scorePointers(): { score: EvalScore; failures: EvalFailure[] } {
  const db = openDb();
  migrate(db);
  const rows = db
    .prepare(
      `SELECT p.file_path, p.symbol, p.resolved, p.resolve_note FROM pointers p
       JOIN decisions d ON d.pointer_id = p.id WHERE d.ticket_id = ? AND p.resolved IS NOT NULL`,
    )
    .all(TICKET) as { file_path: string; symbol: string | null; resolved: number; resolve_note: string | null }[];
  db.close();
  const ok = rows.filter((r) => r.resolved === 1).length;
  return {
    score: {
      id: "pointers",
      label: "Pointers",
      measures: "checked pointers that find their code at the last commit",
      status: rows.length > 0 ? "measured" : "not_run",
      passed: ok,
      total: rows.length,
      also: [],
      ...(rows.length === 0 ? { note: "No pointer has been checked. After the squash merge, run /fork-trail-coach:pointers." } : {}),
    },
    failures: rows
      .filter((r) => r.resolved !== 1)
      .map((r, i) => ({
        id: `pointer-${i + 1}`,
        area: "pointers" as const,
        run: null,
        what: `A pointer no longer finds its code: ${r.file_path}${r.symbol ? `, ${r.symbol}` : ""}.`,
        expected: "Found at the merge commit.",
        got: r.resolve_note ?? "Not found.",
      })),
  };
}

function notRun(id: EvalScore["id"], label: string, measures: string, note: string): EvalScore {
  return { id, label, measures, status: "not_run", passed: 0, total: 0, also: [], note };
}

function score(): void {
  const key = JSON.parse(readFileSync(KEY_FILE, "utf8")) as AnswerKey;
  const runs = savedRuns();
  const fork = scoreFork(runs, key);
  const pointers = scorePointers();
  const privacy = scorePrivacy(DEMO_REPO);
  const results: EvalResultsFile = {
    run_at: new Date().toISOString(),
    ticket_id: TICKET,
    fork_runs: runs.length,
    scores: [
      fork.score,
      notRun("paper_trail", "Paper Trail", "hand-marked decisions that were logged", "Needs the hand-marked decisions from the reference session (EV-2)."),
      pointers.score,
      notRun("coach", "Coach", "claims the seniors rated as supported by their evidence", "Needs the senior review of the growth plans (EV-4)."),
      privacy.score,
    ],
    failures: [...fork.failures, ...pointers.failures, ...privacy.failures],
  };
  const out = defaultEvalResultsPath();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  for (const s of results.scores) {
    console.log(`${s.label.padEnd(14)} ${s.status === "measured" ? `${s.passed} of ${s.total}` : "not run"}`);
  }
  console.log(`\n${results.failures.length} failures logged. Results: ${out}`);
}

const command = process.argv[2] ?? "score";
if (command === "save-run") saveRun();
else if (command === "score") score();
else {
  console.error("Usage: main <save-run|score>");
  process.exitCode = 1;
}
