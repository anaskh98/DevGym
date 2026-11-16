import type { EvalFailure, EvalResults, EvalScore, EvalScoreId } from "@ftc/shared";

/** The five scores, in the order the dashboard shows them. */
export const SCORE_ORDER: readonly EvalScoreId[] = ["fork", "paper_trail", "pointers", "coach", "privacy"];

export const AREA_LABEL: Record<EvalScoreId, string> = {
  fork: "Fork",
  paper_trail: "Paper Trail",
  pointers: "Pointers",
  coach: "Coach",
  privacy: "Privacy guard",
};

/** The scores in dashboard order. A score missing from the file shows as not run. */
export function orderedScores(results: Pick<EvalResults, "scores">): EvalScore[] {
  return SCORE_ORDER.map(
    (id) =>
      results.scores.find((score) => score.id === id) ?? {
        id,
        label: AREA_LABEL[id],
        measures: "",
        status: "not_run" as const,
        passed: 0,
        total: 0,
        also: [],
      },
  );
}

export function isMeasured(score: EvalScore): boolean {
  return score.status === "measured" && score.total > 0;
}

/** "13 of 15", or "Not run yet". */
export function scoreText(score: EvalScore): string {
  return isMeasured(score) ? `${score.passed} of ${score.total}` : "Not run yet";
}

/** How many did not pass. */
export function missed(score: EvalScore): number {
  return isMeasured(score) ? score.total - score.passed : 0;
}

/** Failures grouped the way the scores are ordered, Fork runs first to last. */
export function sortedFailures(failures: readonly EvalFailure[]): EvalFailure[] {
  return [...failures].sort(
    (a, b) =>
      SCORE_ORDER.indexOf(a.area) - SCORE_ORDER.indexOf(b.area) ||
      (a.run ?? 0) - (b.run ?? 0) ||
      a.id.localeCompare(b.id),
  );
}

export function failuresByArea(failures: readonly EvalFailure[]): Record<EvalScoreId, number> {
  const counts: Record<EvalScoreId, number> = { fork: 0, paper_trail: 0, pointers: 0, coach: 0, privacy: 0 };
  for (const failure of failures) counts[failure.area] += 1;
  return counts;
}
