// Finds the ladder for a track: a company file in the repo, then one in the home folder, then the built-in one.
// A broken company file never stops Coach: it falls back to the built-in ladder and says why.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { normalizeRepoPath } from "../../git/identity.js";
import { signalById } from "../signals.js";
import { BUILTIN_LADDERS } from "./builtin.js";
import { DEFAULT_THRESHOLDS, LEVELS, ladderSchema, type Area, type Ladder, type LadderItem, type Level, type Thresholds, type Track } from "./schema.js";

export interface LoadedLadder {
  ladder_id: string;
  track: Track;
  source: "builtin" | "repo" | "home";
  ladder: Ladder;
  thresholds: Thresholds;
  warning?: string;
}

export interface LoadOptions {
  repoRoot: string;
  home?: string;
}

const FILE = join(".fork-trail-coach", "ladder.json");

function withThresholds(ladder: Ladder): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...ladder.thresholds };
}

function unknownSignals(ladder: Ladder): string[] {
  const missing = new Set<string>();
  for (const area of ladder.areas) {
    for (const level of LEVELS) for (const item of area.levels[level]) for (const s of item.signals) if (!signalById(s.id)) missing.add(s.id);
  }
  return [...missing];
}

/** Reads one company file. Returns the ladder for the track, null if the file has none, or an error message. */
function readCompanyFile(path: string, track: Track): { ladder: Ladder } | { error: string } | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    return { error: `${path} is not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const candidates = Array.isArray(raw) ? raw : [raw];
  const forTrack = candidates.find((c) => typeof c === "object" && c !== null && (c as { track?: unknown }).track === track);
  if (forTrack === undefined) return null;
  const parsed = ladderSchema.safeParse(forTrack);
  if (!parsed.success) return { error: `${path}: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
  const missing = unknownSignals(parsed.data);
  if (missing.length > 0) return { error: `${path} names signals that do not exist: ${missing.join(", ")}` };
  return { ladder: parsed.data };
}

export function loadLadder(track: Track, opts: LoadOptions): LoadedLadder {
  const home = opts.home ?? homedir();
  const builtin = BUILTIN_LADDERS[track];
  const tries: { source: "repo" | "home"; path: string; id: string }[] = [
    // The id must not depend on how the path is spelled (slashes, case on Windows), or one ladder would get two ids.
    { source: "repo", path: join(opts.repoRoot, FILE), id: `repo:${createHash("sha256").update(normalizeRepoPath(opts.repoRoot)).digest("hex").slice(0, 8)}/${track}` },
    { source: "home", path: join(home, FILE), id: `home/${track}` },
  ];
  for (const t of tries) {
    const found = readCompanyFile(t.path, track);
    if (found === null) continue;
    if ("error" in found) {
      return {
        ladder_id: `builtin/${track}`,
        track,
        source: "builtin",
        ladder: builtin,
        thresholds: withThresholds(builtin),
        warning: `The company ladder.json could not be used, so the built-in ladder is shown. ${found.error}`,
      };
    }
    return { ladder_id: t.id, track, source: t.source, ladder: found.ladder, thresholds: withThresholds(found.ladder) };
  }
  return { ladder_id: `builtin/${track}`, track, source: "builtin", ladder: builtin, thresholds: withThresholds(builtin) };
}

export function loadActiveLadders(tracks: Track[], opts: LoadOptions): LoadedLadder[] {
  return tracks.map((track) => loadLadder(track, opts));
}

export function findItem(ladder: Ladder, itemId: string): { area: Area; level: Level; item: LadderItem } | null {
  for (const area of ladder.areas) {
    for (const level of LEVELS) {
      const item = area.levels[level].find((i) => i.id === itemId);
      if (item) return { area, level, item };
    }
  }
  return null;
}
