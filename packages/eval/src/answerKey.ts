/**
 * The answer key for a synthetic ticket: the ambiguities planted in it, the
 * questions Fork should NOT ask (decoys), and extras that are neither.
 *
 * The harness (EV-3) scores a Fork run against this.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const PlantedAmbiguity = z.object({
  id: z.string().regex(/^A\d+$/),
  name: z.string(),
  /** The exact words in the ticket that carry the ambiguity. */
  ticket_phrase: z.string(),
  ambiguity: z.string(),
  readings: z.array(z.string()).min(2),
  /** Why the readings lead to different code. */
  code_impact: z.string(),
  /** Files in the demo repo that make the ambiguity real. */
  grounding: z.array(z.string()).min(1),
  /** Words a matching question is likely to use. A starting point for EV-3. */
  match_hints: z.array(z.string()).min(1),
  /** What the PO says when asked, for the demo script. */
  po_answer: z.string(),
});
export type PlantedAmbiguity = z.infer<typeof PlantedAmbiguity>;

export const Decoy = z.object({
  id: z.string().regex(/^D\d+$/),
  question: z.string(),
  /** Where the repo or the ticket already answers it. */
  settled_by: z.string(),
  /** Words a question matching this decoy is likely to use. */
  match_hints: z.array(z.string()).default([]),
});
export type Decoy = z.infer<typeof Decoy>;

export const AcceptableExtra = z.object({
  id: z.string().regex(/^X\d+$/),
  question: z.string(),
  why_acceptable: z.string(),
  match_hints: z.array(z.string()).default([]),
});

export const AnswerKey = z.object({
  ticket_id: z.string(),
  version: z.number().int(),
  note: z.string().optional(),
  /** What changed in each version, newest last. */
  changes: z.array(z.string()).optional(),
  planted: z.array(PlantedAmbiguity),
  decoys: z.array(Decoy),
  acceptable_extras: z.array(AcceptableExtra),
});
export type AnswerKey = z.infer<typeof AnswerKey>;

const here = dirname(fileURLToPath(import.meta.url));
export const ANSWER_KEY_DIR = resolve(here, "../answer-key");

export async function loadAnswerKey(ticketId: string, dir: string = ANSWER_KEY_DIR): Promise<AnswerKey> {
  const raw = await readFile(resolve(dir, `${ticketId}.json`), "utf8");
  return AnswerKey.parse(JSON.parse(raw));
}
