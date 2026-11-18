// UserPromptSubmit hook: when a Coach question is open in this session, save the developer's message as its
// answer, exactly as typed. The AI never writes the answer. A hook must never break the session, so every
// failure ends quietly with exit code 0, and the prompt is never blocked.
import { existsSync } from "node:fs";
import { captureAnswer } from "../coach/questions.js";
import { defaultDbPath, openDb } from "../db/connection.js";
import { migrate } from "../db/migrations.js";
import { pruneMessages, saveMessage } from "../coach/messages.js";
import { containsBlockedName, loadDenylist } from "../privacy/denylist.js";
import { findRuleHit } from "../privacy/rules.js";

interface PromptInput {
  session_id?: unknown;
  prompt?: unknown;
}

async function readStdin(): Promise<string> {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** The privacy check for an answer: no client names, nothing that looks like code or a secret. */
function answerAllowed(text: string): boolean {
  return !containsBlockedName(text, loadDenylist()) && findRuleHit(text) === null;
}

async function main(): Promise<void> {
  const input = JSON.parse(await readStdin()) as PromptInput;
  if (typeof input.session_id !== "string" || typeof input.prompt !== "string") return;
  // No database means no question was ever asked. Do not create one just to find that out.
  if (!existsSync(defaultDbPath())) return;

  const db = openDb();
  try {
    migrate(db);
    // What the developer says is kept locally so "the developer chose this" can be checked against their words.
    // Only once the developer has set Coach up (chosen tracks), so nothing is kept for someone who never opted in.
    const tracks = (db.prepare("SELECT value FROM coach_settings WHERE key = 'tracks'").get() as { value: string } | undefined)?.value;
    if (tracks !== undefined && JSON.parse(tracks).length > 0 && answerAllowed(input.prompt)) saveMessage(db, input.session_id, input.prompt);
    pruneMessages(db, 120);
    const result = captureAnswer(db, input.session_id, input.prompt, new Date(), answerAllowed);
    if (!result.captured) {
      if (result.held_back) {
        const note =
          "Coach: this message was not saved as the answer, because it looked like code, a secret or a client name. The question is still open. Ask the developer to answer in plain words.";
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: note } }));
      }
      return;
    }
    const note =
      result.closed === "answered"
        ? `Coach: saved this message as the answer to question ${result.question_id}. Rate it with rate_answer (for a drill: drill_key, then score_drill). If it was not really an answer, call release_answer.`
        : `Coach: kept question ${result.question_id} for later. Do not rate it.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: note } }));
  } finally {
    db.close();
  }
}

try {
  await main();
} catch (err) {
  console.error(`fork-trail-coach prompt hook: ${err instanceof Error ? err.message : String(err)}`);
}
process.exitCode = 0;
