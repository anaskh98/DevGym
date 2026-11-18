// Exposure: how much chance the developer's work gave them to use a skill, kept apart from how well they used it.
// Low exposure is never read as low skill: it only means Grow has not seen enough to judge.
import type { Db } from "../db/connection.js";
import { toIso } from "./facts.js";
import type { Thresholds } from "./ladder/schema.js";

export type ExposureLevel = "none" | "low" | "medium" | "high";

export interface Exposure {
  level: ExposureLevel;
  /** Distinct functions in the window where the work touched the skill. */
  functions: number;
}

/** Distinct (file, function) chances in the window, from exposure rows and the item's rule evidence. */
export function exposureFor(db: Db, ladderId: string, itemId: string, now: Date, t: Thresholds): Exposure {
  const since = now.getTime() - t.exposure_window_days * 86_400_000;
  const rows = [
    ...(db.prepare("SELECT file_path, symbol, at FROM skill_exposure WHERE ladder_id = ? AND item_id = ?").all(ladderId, itemId) as {
      file_path: string | null;
      symbol: string | null;
      at: string;
    }[]),
    ...(db.prepare("SELECT file_path, symbol, at FROM skill_evidence WHERE ladder_id = ? AND item_id = ? AND kind = 'rule'").all(ladderId, itemId) as {
      file_path: string | null;
      symbol: string | null;
      at: string;
    }[]),
  ];
  const seen = new Set<string>();
  for (const r of rows) {
    if (Date.parse(toIso(r.at)) < since) continue;
    seen.add(`${r.file_path ?? ""}\0${r.symbol ?? ""}`);
  }
  const functions = seen.size;
  const level: ExposureLevel =
    functions >= t.exposure_high ? "high" : functions >= t.exposure_medium ? "medium" : functions >= t.exposure_low ? "low" : "none";
  return { level, functions };
}
