/**
 * The privacy guard seam.
 *
 * Every write to SQLite goes through Store, and Store calls the guard before
 * it touches the database. Week 1 ships the seam and a guard that allows
 * everything; BE-9 replaces PendingGuard with the real rules (code-overlap
 * check against the repo, client-name denylist, code-pattern rules) without
 * changing any caller.
 */
import { PrivacyRejection } from "../errors";

export type RecordKind =
  | "ticket"
  | "assumption"
  | "pointer"
  | "decision"
  | "explain_back"
  | "observation"
  | "growth_plan"
  | "annotation";

export interface GuardInput {
  kind: RecordKind;
  /** The free-text fields about to be written, by field name. */
  fields: Record<string, string | readonly string[] | null | undefined>;
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; rule: string; field: string; reason: string };

export interface PrivacyGuard {
  readonly name: string;
  check(input: GuardInput): GuardVerdict;
}

/**
 * Placeholder until BE-9. Allows every write.
 * Do not store real client code or names while this guard is active.
 */
export class PendingGuard implements PrivacyGuard {
  readonly name = "pending (BE-9 not built: all writes allowed)";
  check(): GuardVerdict {
    return { ok: true };
  }
}

export function assertAllowed(guard: PrivacyGuard, input: GuardInput): void {
  const verdict = guard.check(input);
  if (!verdict.ok) {
    throw new PrivacyRejection(verdict.rule, verdict.field, verdict.reason);
  }
}
