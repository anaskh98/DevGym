import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify, hintScore, scoreFork, type AnswerKey } from "./fork.js";
import { ATTEMPTS, HARMLESS, scorePrivacy } from "./privacy.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..", "..");
const key = JSON.parse(readFileSync(join(ROOT, "packages", "eval", "answer-key", "DEMO-1.json"), "utf8")) as AnswerKey;

describe("Fork scoring", () => {
  it("matches hints at the start of a word only", () => {
    expect(hintScore("Can they cancel late?", ["late"])).toBe(1);
    expect(hintScore("How do we translate it?", ["late"])).toBe(0);
    expect(hintScore("Can admins cancel?", ["admin"])).toBe(1);
  });

  it("sorts the questions from the stand-in run of 15 Nov into the planted ambiguities", () => {
    const questions = [
      "A member tries to cancel their own booking when it starts in less than 24 hours. What should happen?",
      "A member paid for a booking from their team's credits and then cancels it. Where do the credits go back?",
      "When an admin cancels a booking, which rules apply?",
      "Who gets a message when a booking is cancelled?",
      "Finance invoices from the monthly room usage report. How should a cancelled booking show there?",
    ];
    expect(questions.map((q) => classify(q, key).id)).toEqual(["A1", "A3", "A4", "A5", "A2"]);
  });

  it("counts decoys as false alarms and lists every miss", () => {
    const { score, failures } = scoreFork(
      [{ run: 1, questions: ["Which time zone are the 24 hours measured in?", "Who should be notified?"] }],
      key,
    );
    expect(score).toMatchObject({ passed: 1, total: 5 });
    expect(score.also.find((a) => a.label === "false alarms")?.value).toBe(1);
    expect(failures.filter((f) => f.id.includes("missed"))).toHaveLength(4);
  });

  it("is not run when no Fork run was saved", () => {
    expect(scoreFork([], key).score.status).toBe("not_run");
  });
});

describe("privacy red team", () => {
  it("blocks every attempt and lets plain descriptions through", () => {
    const { score, failures } = scorePrivacy(join(ROOT, "demo-repo"));
    expect(failures).toEqual([]);
    expect(score.passed).toBe(ATTEMPTS.length);
    expect(score.also[0]?.value).toBe(0);
    expect(HARMLESS.length).toBeGreaterThan(0);
  });
});
