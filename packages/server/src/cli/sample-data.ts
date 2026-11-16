/**
 * pnpm mock:refresh — rebuild the sample data the web app shows by default
 * (packages/web/public/mock).
 *
 * It plays a made-up coding session on the sample ticket through the real
 * Store, with the same input validation the MCP tools use, so the mocks are
 * always in a shape the database can actually produce.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  AnnotationInput,
  AssumptionInput,
  EvalResults,
  focusTargetId,
  FocusAreaInput,
  LogDecisionInput,
  RecordExplainBackInput,
  SaveObservationInput,
} from "@ftc/shared";
import { z } from "zod";
import { openDb } from "../db/connection";
import { migrate } from "../db/migrate";
import { Store } from "../db/store";
import { PendingGuard } from "../privacy/guard";
import { MarkdownTicketSource } from "../tickets/markdown";
import { exportMock } from "./export-mock";
import { flag, REPO_ROOT, WEB_MOCK_DIR } from "./shared";

const FIXTURES = resolve(REPO_ROOT, "packages/server/fixtures");
const SESSION_START = new Date("2026-11-12T09:00:00.000Z");

interface Scenario {
  ticket_id: string;
  session_id: string;
  repo: string;
  commit: string;
  decisions: Array<{
    key: string;
    at: number;
    summary: string;
    alternatives: string[];
    origin: string;
    pointer: { file_path: string; line_hint?: number; symbol?: string; unlinked?: boolean };
  }>;
  explain_backs: Array<{ decision: string; at: number; question: string; answer: string; rating: string }>;
  observations: Array<{ key: string; at: number; skill_tag: string; summary: string; evidence: string[] }>;
  growth_plan: { at: number; focus_areas: Array<{ claim: string; evidence: string[]; exercise: string }> };
  /** `focus` is the position of the focus area, counted from 1. */
  annotations: Array<{ at: number; focus: number; note: string; disagrees: boolean }>;
}

const readJson = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(join(FIXTURES, name), "utf8")) as T;

const fork = await readJson<{ ticket_id: string; assumptions: unknown[] }>("sample-fork-run.json");
const scenario = await readJson<Scenario>("sample-trail.json");

// A clock the script moves forward, so the timeline has believable times.
let now = SESSION_START;
const at = (minutes: number) => {
  now = new Date(SESSION_START.getTime() + minutes * 60_000);
};

const db = openDb(":memory:");
migrate(db);
const store = new Store(db, { guard: new PendingGuard(), now: () => now });

// Fork
at(2);
const source = new MarkdownTicketSource(join(FIXTURES, "tickets"));
const ticket = await source.get(scenario.ticket_id);
if (!ticket) throw new Error(`Sample ticket ${scenario.ticket_id} not found in ${FIXTURES}/tickets`);
store.upsertTicket({ ...ticket, source: source.name });

at(9);
store.saveAssumptions(fork.ticket_id, z.array(AssumptionInput).parse(fork.assumptions));

// Paper Trail
const decisionIds = new Map<string, string>();
for (const item of scenario.decisions) {
  at(item.at);
  const { unlinked, ...pointer } = item.pointer;
  const input = z.object(LogDecisionInput).parse({
    ticket_id: scenario.ticket_id,
    session_id: scenario.session_id,
    summary: item.summary,
    alternatives: item.alternatives,
    origin: item.origin,
    // A pointer the pointer service has not resolved yet has no repo or commit.
    pointer: unlinked ? pointer : { ...pointer, repo: scenario.repo, commit: scenario.commit },
  });
  const { decision } = store.logDecision({ ...input, session_id: scenario.session_id });
  decisionIds.set(item.key, decision.id);
}

// Explain-back
const explainIds = new Map<string, string>();
for (const item of scenario.explain_backs) {
  at(item.at);
  const decisionId = decisionIds.get(item.decision);
  if (!decisionId) throw new Error(`Unknown decision key: ${item.decision}`);
  const input = z.object(RecordExplainBackInput).parse({
    decision_id: decisionId,
    question: item.question,
    answer: item.answer,
    rating: item.rating,
  });
  explainIds.set(item.decision, store.recordExplainBack(input).id);
}

// Observations and growth plan
const DEVELOPER = "sample-dev";
const evidenceId = (ref: string): string => {
  const [kind, key] = ref.split(":");
  const id = kind === "decision" ? decisionIds.get(key ?? "") : explainIds.get(key ?? "");
  if (!id) throw new Error(`Unknown evidence: ${ref}`);
  return id;
};

const observationIds = new Map<string, string>();
for (const item of scenario.observations) {
  at(item.at);
  const input = z.object(SaveObservationInput).parse({
    skill_tag: item.skill_tag,
    summary: item.summary,
    evidence_ids: item.evidence.map(evidenceId),
  });
  observationIds.set(item.key, store.saveObservation({ ...input, developer_id: DEVELOPER }).id);
}

at(scenario.growth_plan.at);
const plan = store.saveGrowthPlan({
  developer_id: DEVELOPER,
  focus_areas: z.array(FocusAreaInput).parse(
    scenario.growth_plan.focus_areas.map((area) => ({
      claim: area.claim,
      exercise: area.exercise,
      evidence_ids: area.evidence.map((key) => {
        const id = observationIds.get(key);
        if (!id) throw new Error(`Unknown observation key: ${key}`);
        return id;
      }),
    })),
  ),
});

// The developer's own notes on the plan
for (const item of scenario.annotations) {
  at(item.at);
  store.addAnnotation(
    AnnotationInput.parse({
      target_id: focusTargetId(plan.id, item.focus - 1),
      note: item.note,
      disagrees: item.disagrees,
    }),
  );
}

at((scenario.annotations.at(-1)?.at ?? scenario.growth_plan.at) + 5);
const files = await exportMock(store, flag("out") ?? WEB_MOCK_DIR, {
  storedIn: "~/.ftc/ftc.sqlite",
  developerId: DEVELOPER,
  exportedAt: now,
  // Made-up numbers, so the Eval page has something to draw before EV-3 exists.
  evalResults: EvalResults.parse(await readJson<unknown>("sample-eval.json")),
});
db.close();
for (const file of files) console.log(`wrote ${file}`);
