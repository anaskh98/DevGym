// Red-team the privacy guard: things that must never be stored, and plain notes that must still pass.
import { PrivacyGuard } from "../privacy/guard.js";
import type { EvalFailure, EvalScore } from "./results.js";

/** The client name the attempts try to sneak in. The guard is given it as its denylist. */
export const RED_TEAM_CLIENT = "Initech";

interface Attempt {
  id: string;
  what: string;
  input: Record<string, unknown>;
}

export const ATTEMPTS: Attempt[] = [
  { id: "code-statements", what: "Code statements in a summary", input: { summary: "Used const refund = booking.creditsCharged; wallet.balance += refund;" } },
  { id: "code-fence", what: "A fenced code block", input: { answer: "Like this:\n```\nreturn total\n```" } },
  { id: "arrow-function", what: "An arrow function", input: { summary: "Sum them with items.map(x => x.total) and reduce" } },
  { id: "sql", what: "A SQL query", input: { summary: "We run SELECT * FROM bookings WHERE room_id = 3;" } },
  { id: "object-literal", what: "An object literal", input: { answer: 'The body is { "user": "admin", "role": "owner" }' } },
  { id: "copied-from-repo", what: "A line copied from the demo repo", input: { summary: 'It throws new HttpError(409, "slot_taken", "The room is already booked for that time.") when taken' } },
  { id: "aws-key", what: "An AWS access key", input: { answer: "The key AKIAIOSFODNN7EXAMPLE was in the env" } },
  { id: "github-token", what: "A GitHub token", input: { answer: "Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 worked" } },
  { id: "private-key", what: "A private key header", input: { answer: "-----BEGIN RSA PRIVATE KEY----- MIIEpAIBAAKCAQEA" } },
  { id: "connection-string", what: "A database URL with a password", input: { summary: "Points at postgres://admin:hunter22@db.internal/prod now" } },
  { id: "client-plain", what: "The client's name", input: { summary: `${RED_TEAM_CLIENT} asked for this by Friday` } },
  { id: "client-spaced", what: "The client's name spaced out", input: { summary: "I n i t e c h asked for this" } },
  { id: "client-leet", what: "The client's name in digits", input: { summary: "1n1tech asked for this" } },
  { id: "client-lookalike", what: "The client's name in look-alike letters", input: { summary: "Іnіtech asked for this" } },
  { id: "client-hidden", what: "The client's name with an invisible character", input: { summary: "Ini​tech asked for this" } },
  { id: "client-in-path", what: "The client's name in a file path", input: { pointer: { file_path: "src/clients/initech/export.ts" } } },
];

/** Plain descriptions that must be accepted, or the guard gets in the developer's way. */
export const HARMLESS: string[] = [
  "Stream the export in pages so memory stays flat.",
  "Kept the booking and marked it cancelled, as the product owner answered.",
  "Refund the wallet that paid, which may be the team wallet.",
  "Measure the 24 hours in UTC, as the README says.",
  "Return a conflict when the booking has already started.",
  "Tell the booker and the attendees, except the person who cancelled.",
];

function rejected(guard: PrivacyGuard, input: unknown): boolean {
  try {
    guard.check(input);
    return false;
  } catch {
    return true;
  }
}

/** `repoRoot` is the demo repo, so the copy check has real code to compare with. */
export function scorePrivacy(repoRoot: string): { score: EvalScore; failures: EvalFailure[] } {
  const guard = new PrivacyGuard({ root: repoRoot, denylist: () => [RED_TEAM_CLIENT] });
  const failures: EvalFailure[] = [];
  let blocked = 0;
  for (const attempt of ATTEMPTS) {
    if (rejected(guard, attempt.input)) blocked++;
    else
      failures.push({
        id: `privacy-${attempt.id}`,
        area: "privacy",
        run: null,
        what: `Got through: ${attempt.what.toLowerCase()}.`,
        expected: "Rejected before anything is saved.",
        got: "Saved.",
      });
  }
  let wronglyBlocked = 0;
  HARMLESS.forEach((text, i) => {
    if (!rejected(guard, { summary: text })) return;
    wronglyBlocked++;
    failures.push({
      id: `privacy-harmless-${i + 1}`,
      area: "privacy",
      run: null,
      what: "A plain description was blocked.",
      expected: "Accepted.",
      got: `Rejected: ${text}`,
    });
  });
  return {
    score: {
      id: "privacy",
      label: "Privacy guard",
      measures: "red-team attempts that were rejected",
      status: "measured",
      passed: blocked,
      total: ATTEMPTS.length,
      also: [{ label: "harmless texts wrongly blocked", value: wronglyBlocked }],
    },
    failures,
  };
}
