import type { CoachArea, CoachExposure, CoachItem, CoachState } from "@ftc/shared";

/** Proficiency, in plain words. Not assessed is never a gap: it only means there is not enough to judge yet. */
export const STATE_LABEL: Record<CoachState, string> = {
  not_seen: "Not seen",
  not_assessed: "Not assessed",
  learning: "Learning",
  shown: "Shown",
  proven: "Proven",
};

export const EXPOSURE_LABEL: Record<CoachExposure, string> = {
  none: "no exposure",
  low: "low exposure",
  medium: "medium exposure",
  high: "high exposure",
};

export const STATE_HINT: Record<CoachState, string> = {
  not_seen: "Nothing yet: no evidence and no chance to use this skill.",
  not_assessed: "Some evidence, not enough to judge, and no sign of a gap.",
  learning: "A sign of a real gap: an open fault, a weak answer or a failed drill.",
  shown: "Shown in your work, or by drills when your work gave little chance. A drill can make it Proven.",
  proven: "Shown in your work, and a practical drill was passed.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Mid, working toward Senior" or "Starting, working toward Junior". */
export function levelText(area: Pick<CoachArea, "level" | "working_toward">): string {
  const level = area.level ? cap(area.level) : "Starting";
  return area.working_toward ? `${level}, working toward ${cap(area.working_toward)}` : level;
}

/** The skills worth showing in a list: anything with evidence, or the level being worked on. */
export function visibleItems(area: CoachArea): CoachItem[] {
  const target = area.working_toward ?? area.level;
  return area.items.filter((i) => i.level === target || i.state !== "not_seen");
}

/** One short line saying what the evidence is, never the code. */
export function evidenceLine(e: { kind: string; polarity: string; author: string; decided_by: string | null; owned: boolean; file: string | null; symbol: string | null; ticket: string; signal: string | null; note: string | null }): string {
  const where = e.file ? `${e.file}${e.symbol ? ` (${e.symbol})` : ""}` : "";
  const who = e.kind === "decision" ? `decision by ${e.decided_by === "dev" ? "you" : "the AI"}` : e.author === "ai" ? "written by the AI" : e.author === "dev" ? "written by you" : "";
  const what = e.note ?? (e.signal ? e.signal.replace(".", " · ").replace(/-/g, " ") : e.kind);
  return [what, where, `ticket ${e.ticket}`, who, e.owned ? "owned by you: you shipped it" : ""].filter(Boolean).join(" · ");
}
