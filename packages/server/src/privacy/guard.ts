// The privacy guard. Every write to the local store passes through check() first.
// Three checks: client-name denylist, code and secret patterns, and overlap with the repo's code.
import { PrivacyError } from "../errors.js";
import { containsBlockedName, loadDenylist } from "./denylist.js";
import { RepoCodeIndex } from "./overlap.js";
import { findRuleHit } from "./rules.js";

/**
 * Fields that hold references (ids, paths, names of symbols), not free text.
 * They only get the denylist check: a path or a function name is not "code".
 * Any field NOT listed here gets every check, so a new field is guarded by default.
 */
const REFERENCE_FIELDS = new Set([
  "ticket_id",
  "session_id",
  "decision_id",
  "developer_id",
  "target_id",
  "evidence_ids",
  "repo",
  "file_path",
  "symbol",
  "related_files",
  "commit",
  "skill_tag",
  "status",
  "origin",
  "rating",
]);

export interface PrivacyGuardOptions {
  /** The repo folder. Free text is compared with the code under it. */
  root: string;
  /** Returns the blocked client names. Read on every check, so edits to the list apply at once. */
  denylist?: () => string[];
}

export class PrivacyGuard {
  private readonly index: RepoCodeIndex;
  private readonly denylist: () => string[];

  constructor(options: PrivacyGuardOptions) {
    this.index = new RepoCodeIndex(options.root);
    this.denylist = options.denylist ?? (() => loadDenylist());
  }

  /** Checks every string in a tool input. Throws PrivacyError on the first problem. */
  check(input: unknown): void {
    const names = this.denylist();
    this.walk(input, "", "", names);
  }

  /** Tickets are source material, so they may describe code. They still must not name a client. */
  checkTicket(ticket: { id: string; title: string; body: string }): void {
    const names = this.denylist();
    for (const [field, value] of Object.entries(ticket)) {
      if (containsBlockedName(value, names)) throw blockedName(`ticket.${field}`);
    }
  }

  /** For the edit hook: a path that names a client is not recorded at all. */
  pathAllowed(path: string): boolean {
    return !containsBlockedName(path, this.denylist());
  }

  private walk(value: unknown, path: string, key: string, names: string[]): void {
    if (typeof value === "string") {
      this.checkString(value, path, REFERENCE_FIELDS.has(key), names);
    } else if (Array.isArray(value)) {
      value.forEach((item, i) => this.walk(item, `${path}[${i}]`, key, names));
    } else if (value !== null && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) this.walk(v, path ? `${path}.${k}` : k, k, names);
    }
  }

  private checkString(text: string, field: string, isReference: boolean, names: string[]): void {
    if (containsBlockedName(text, names)) throw blockedName(field);
    if (isReference) return;
    const hit = findRuleHit(text);
    if (hit?.kind === "secret") {
      throw new PrivacyError(field, hit.rule, "looks like it holds a secret or credential. Remove it");
    }
    if (hit) {
      throw new PrivacyError(field, hit.rule, "looks like code. Describe the choice in plain words instead");
    }
    if (this.index.overlaps(text)) {
      throw new PrivacyError(field, "code-overlap", "copies code from this repository. Describe it in plain words instead");
    }
  }
}

function blockedName(field: string): PrivacyError {
  return new PrivacyError(field, "client-name", "contains a name from the client denylist. Refer to the client without naming it");
}
