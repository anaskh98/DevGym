import type { Assumption, ForkRun } from "@ftc/shared";

export interface ForkSummary {
  total: number;
  answeredByPo: number;
  assumedByDev: number;
}

export function summarize(run: ForkRun): ForkSummary {
  const answeredByPo = run.assumptions.filter((a) => a.status === "answered_by_po").length;
  return {
    total: run.assumptions.length,
    answeredByPo,
    assumedByDev: run.assumptions.length - answeredByPo,
  };
}

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Which of the offered readings was taken, when the answer is one of them
 * word for word. -1 when the answer was given in other words.
 */
export function takenReadingIndex(assumption: Pick<Assumption, "readings" | "answer">): number {
  const answer = normalize(assumption.answer);
  if (!answer) return -1;
  return assumption.readings.findIndex((reading) => normalize(reading) === answer);
}

export function plural(count: number, one: string, many: string = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
