// Scores saved Clarify runs against the answer key. Matching is by keyword, so it is approximate:
// every miss and false alarm is listed in the failure log for a person to check.
import type { EvalFailure, EvalScore } from "./results.js";

export interface KeyItem {
  id: string;
  name?: string;
  question?: string;
  ambiguity?: string;
  match_hints: string[];
}

export interface AnswerKey {
  ticket_id: string;
  planted: KeyItem[];
  decoys: (KeyItem & { settled_by: string })[];
  acceptable_extras: KeyItem[];
}

export interface ClarifyRun {
  run: number;
  questions: string[];
}

const normalize = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** How many of the hints the text uses. A hint must start at a word, so "late" does not match "translate". */
export function hintScore(text: string, hints: string[]): number {
  const t = normalize(text);
  return hints.filter((h) => t.includes(` ${normalize(h).trim()}`)).length;
}

type Match = { kind: "planted" | "decoy" | "extra" | "none"; id: string | null };

/**
 * Sorts one question: the key item whose hints it uses most. On a tie a decoy wins over a planted item
 * (a decoy is a narrow, specific question), and a planted item wins over an acceptable extra.
 */
export function classify(question: string, key: AnswerKey): Match {
  let best: Match = { kind: "none", id: null };
  let bestScore = 0;
  const groups: [Match["kind"], KeyItem[]][] = [
    ["decoy", key.decoys],
    ["planted", key.planted],
    ["extra", key.acceptable_extras],
  ];
  for (const [kind, items] of groups) {
    for (const item of items) {
      const score = hintScore(question, item.match_hints);
      if (score > bestScore) {
        best = { kind, id: item.id };
        bestScore = score;
      }
    }
  }
  return best;
}

export function scoreClarify(runs: ClarifyRun[], key: AnswerKey): { score: EvalScore; failures: EvalFailure[] } {
  const failures: EvalFailure[] = [];
  let caught = 0;
  let falseAlarms = 0;
  let unmatched = 0;
  for (const run of runs) {
    const found = new Set<string>();
    run.questions.forEach((question, i) => {
      const match = classify(question, key);
      if (match.kind === "planted" && match.id) found.add(match.id);
      if (match.kind === "decoy") {
        falseAlarms++;
        const decoy = key.decoys.find((d) => d.id === match.id);
        failures.push({
          id: `fork-r${run.run}-false-${i + 1}`,
          area: "fork",
          run: run.run,
          what: `False alarm: asked something the repo or ticket already settles (${match.id}).`,
          expected: `No question. ${decoy?.settled_by ?? ""}`.trim(),
          got: question,
        });
      }
      if (match.kind === "none") {
        unmatched++;
        failures.push({
          id: `fork-r${run.run}-unmatched-${i + 1}`,
          area: "fork",
          run: run.run,
          what: "Not matched to the answer key. Check by hand: a real fork, or a false alarm?",
          expected: "A question about one of the planted ambiguities.",
          got: question,
        });
      }
    });
    for (const planted of key.planted) {
      if (found.has(planted.id)) caught++;
      else
        failures.push({
          id: `fork-r${run.run}-missed-${planted.id}`,
          area: "fork",
          run: run.run,
          what: `Missed: ${planted.name ?? planted.id}.`,
          expected: planted.ambiguity ?? `A question about ${planted.id}.`,
          got: "No question matched it in this run.",
        });
    }
  }
  const total = runs.length * key.planted.length;
  return {
    score: {
      id: "fork",
      label: "Clarify",
      measures: `planted ambiguities caught, across ${runs.length} run${runs.length === 1 ? "" : "s"}`,
      status: runs.length > 0 ? "measured" : "not_run",
      passed: caught,
      total,
      also: [
        { label: "false alarms", value: falseAlarms },
        { label: "questions to check by hand", value: unmatched },
      ],
      ...(runs.length === 0
        ? { note: "No Clarify runs saved. After each /clarify run on the demo ticket, run pnpm eval:save-run." }
        : { note: "Questions are matched to the answer key by keyword. Check the failure log by hand." }),
    },
    failures,
  };
}
