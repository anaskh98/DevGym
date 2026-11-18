// The ladder: what a junior, mid, senior and staff engineer can do, split into small items that can be checked.
// Built-in ladders and company files are both checked with this schema.
import { z } from "zod";

export type Track = "backend" | "frontend";
export const TRACKS = ["backend", "frontend"] as const;
export const LEVELS = ["junior", "mid", "senior", "staff"] as const;
export type Level = (typeof LEVELS)[number];

/** The level letter in an item id: BE.ERR.M2 is a mid item. X is staff. */
export const LEVEL_LETTER: Record<Level, string> = { junior: "J", mid: "M", senior: "S", staff: "X" };
export const ITEM_ID = /^(BE|FE)\.[A-Z][A-Z0-9]{1,7}\.[JMSX]\d{1,2}$/;

export interface SignalRef {
  id: string;
  polarity: "positive" | "negative";
  regresses?: boolean;
}
export interface Drill {
  id: string;
  prompt: string;
  key_points: { id: string; text: string }[];
  red_flags: { id: string; text: string }[];
  pass?: number;
}
export interface StackNote {
  note: string;
  link: string;
}
export interface LadderItem {
  id: string;
  title: string;
  good_looks_like: string[];
  signals: SignalRef[];
  explain_angles: string[];
  drills: Drill[];
  study: string[];
  stack_notes: Record<string, StackNote>;
  /** Signals that show the developer had the chance to use this skill, used or not. Optional for old company files. */
  exposure_signals?: string[];
}
export interface Area {
  id: string;
  name: string;
  levels: Record<Level, LadderItem[]>;
}
export interface Thresholds {
  proofs: number;
  tickets: number;
  window_days: number;
  clear_answers: number;
  judge_cap: number;
  drill_retry_days: number;
  question_timeout_min: number;
  max_questions: number;
  hash_keep_days: number;
  catchup_max: number;
  exposure_window_days: number;
  exposure_low: number;
  exposure_medium: number;
  exposure_high: number;
}
export interface Ladder {
  track: Track;
  areas: Area[];
  thresholds?: Partial<Thresholds>;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  proofs: 3,
  tickets: 2,
  window_days: 60,
  clear_answers: 2,
  judge_cap: 1,
  drill_retry_days: 3,
  question_timeout_min: 30,
  max_questions: 3,
  hash_keep_days: 120,
  catchup_max: 200,
  exposure_window_days: 90,
  exposure_low: 1,
  exposure_medium: 3,
  exposure_high: 6,
};

/** How many key points a drill answer must hit: the drill's own number, or two thirds rounded up. */
export function passCount(drill: Drill): number {
  return drill.pass ?? Math.ceil((2 / 3) * drill.key_points.length);
}

const text = z.string().trim().min(1).max(600);
const shortId = z.string().trim().regex(/^[a-z0-9][a-z0-9._-]{0,40}$/, "ids are lowercase letters, digits, dots and dashes");
const point = z.strictObject({ id: shortId, text });

const drillSchema = z
  .strictObject({
    id: shortId,
    prompt: z.string().trim().min(10).max(1500),
    key_points: z.array(point).min(2).max(10),
    red_flags: z.array(point).max(10),
    pass: z.number().int().min(1).optional(),
  })
  .superRefine((d, ctx) => {
    if (d.pass !== undefined && d.pass > d.key_points.length) {
      ctx.addIssue({ code: "custom", message: `Drill ${d.id}: pass is ${d.pass} but it has ${d.key_points.length} key points` });
    }
    const ids = [...d.key_points, ...d.red_flags].map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `Drill ${d.id}: key point and red flag ids must be unique` });
  });

const itemSchema = z.strictObject({
  id: z.string().regex(ITEM_ID, "item ids look like BE.ERR.M2"),
  title: text,
  good_looks_like: z.array(text).min(1).max(3),
  signals: z.array(z.strictObject({ id: shortId, polarity: z.enum(["positive", "negative"]), regresses: z.boolean().optional() })).max(10),
  explain_angles: z.array(text).min(1).max(3),
  drills: z.array(drillSchema).min(1).max(3),
  study: z.array(text).min(2).max(4),
  exposure_signals: z.array(shortId).max(10).optional(),
  stack_notes: z.record(
    shortId,
    z.strictObject({ note: text, link: z.string().regex(/^https:\/\/\S+$/, "stack note links must start with https://") }),
  ),
});

const thresholdsSchema = z.strictObject(
  Object.fromEntries(Object.keys(DEFAULT_THRESHOLDS).map((k) => [k, z.number().int().positive()])) as Record<
    keyof Thresholds,
    z.ZodNumber
  >,
);

export const ladderSchema = z
  .strictObject({
    track: z.enum(TRACKS),
    areas: z
      .array(
        z.strictObject({
          id: z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/, "area ids are 2 to 8 capital letters or digits, starting with a letter"),
          name: text,
          levels: z.strictObject({ junior: z.array(itemSchema), mid: z.array(itemSchema), senior: z.array(itemSchema), staff: z.array(itemSchema) }),
        }),
      )
      .min(1),
    thresholds: thresholdsSchema.partial().optional(),
  })
  .superRefine((ladder, ctx) => {
    const prefix = ladder.track === "backend" ? "BE." : "FE.";
    const seen = new Set<string>();
    for (const area of ladder.areas) {
      for (const level of LEVELS) {
        for (const item of area.levels[level]) {
          if (seen.has(item.id)) ctx.addIssue({ code: "custom", message: `${item.id} is used more than once` });
          seen.add(item.id);
          if (!item.id.startsWith(prefix)) {
            ctx.addIssue({ code: "custom", message: `${item.id} does not start with ${prefix} in a ${ladder.track} ladder` });
          }
          const letter = item.id.split(".")[2]?.[0];
          if (letter !== LEVEL_LETTER[level]) {
            const said = LEVELS.find((l) => LEVEL_LETTER[l] === letter) ?? "an unknown level";
            ctx.addIssue({ code: "custom", message: `${item.id} sits under ${level} but its id says ${said}` });
          }
        }
      }
    }
  }) as unknown as z.ZodType<Ladder>;
