// The file the eval writes and the web app's Eval page reads (GET /api/eval).
// The same shape is in packages/shared/src/api.ts (EvalResults); a test checks the two agree.

export type EvalScoreId = "fork" | "paper_trail" | "pointers" | "coach" | "privacy";

export interface EvalScore {
  id: EvalScoreId;
  label: string;
  measures: string;
  status: "measured" | "not_run";
  passed: number;
  total: number;
  also: { label: string; value: number }[];
  note?: string;
}

export interface EvalFailure {
  id: string;
  area: EvalScoreId;
  run: number | null;
  what: string;
  expected: string;
  got: string;
}

export interface EvalResultsFile {
  run_at: string;
  ticket_id: string;
  fork_runs: number;
  scores: EvalScore[];
  failures: EvalFailure[];
}
