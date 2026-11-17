import type { EvalResultsFile } from "../eval/results.js";

/** Made-up results, so the Eval page has something to show in mock mode. The page says they are made up. */
export const SAMPLE_EVAL: EvalResultsFile = {
  run_at: "2026-11-16T12:00:00.000Z",
  ticket_id: "SAMPLE-1",
  fork_runs: 3,
  scores: [
    { id: "fork", label: "Fork", measures: "planted ambiguities caught, across 3 runs", status: "measured", passed: 13, total: 15, also: [{ label: "false alarms", value: 2 }] },
    { id: "paper_trail", label: "Paper Trail", measures: "hand-marked decisions that were logged", status: "measured", passed: 9, total: 11, also: [] },
    { id: "pointers", label: "Pointers", measures: "pointers that still resolve after the squash merge", status: "measured", passed: 10, total: 11, also: [] },
    { id: "coach", label: "Coach", measures: "claims the seniors rated as supported by their evidence", status: "not_run", passed: 0, total: 0, also: [], note: "Needs the senior review (EV-4)." },
    { id: "privacy", label: "Privacy guard", measures: "red-team attempts that were rejected", status: "measured", passed: 15, total: 16, also: [{ label: "harmless texts wrongly blocked", value: 0 }] },
  ],
  failures: [
    { id: "fork-r2-missed", area: "fork", run: 2, what: "Missed: who may export.", expected: "A question about which roles can export.", got: "No question; the run assumed it silently." },
    { id: "fork-r3-missed", area: "fork", run: 3, what: "Missed: very large exports.", expected: "A question about downloading at once or emailing a link.", got: "No question." },
    { id: "fork-r1-false", area: "fork", run: 1, what: "False alarm: asked which file format to use.", expected: "No question: the ticket settles it.", got: "Asked the PO to choose between CSV and XLSX." },
    { id: "fork-r3-false", area: "fork", run: 3, what: "False alarm: asked what the route should be called.", expected: "No question: the README has a route convention.", got: "Asked the PO to pick a route name." },
    { id: "trail-1", area: "paper_trail", run: null, what: "The permission check was edited with no decision logged.", expected: "A decision pointing at src/routes/orders.ts.", got: "The file was flagged as unexplained." },
    { id: "trail-2", area: "paper_trail", run: null, what: "The date format in the file was not logged.", expected: "A decision on writing dates as ISO 8601.", got: "Nothing recorded." },
    { id: "pointer-1", area: "pointers", run: null, what: "A pointer broke after the squash merge.", expected: "exportRoute found at the merge commit.", got: "exportRoute is not in src/routes/orders.ts at this commit." },
    { id: "privacy-1", area: "privacy", run: null, what: "A client name split across a file path got through.", expected: "Rejected by the client-name denylist.", got: "Saved." },
  ],
};
