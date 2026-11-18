// The growth dashboard's data: levels per area, exposure apart from proficiency, the evidence behind every state,
// repeats, open faults, drills ready and done, and what to do next. Read only: it never reads git or runs AI, so it
// is fast. The background worker and /grow keep the data fresh. Every state links to its evidence.
import type { Db } from "../db/connection.js";
import { repeats } from "./bugs.js";
import { drillsReady } from "./drills.js";
import { toIso } from "./facts.js";
import { findItem, loadActiveLadders } from "./ladder/load.js";
import { LEVELS } from "./ladder/schema.js";
import { getTracks } from "./settings.js";
import { areaViews, computeStatuses, stateHistory } from "./status.js";

const EVIDENCE_PER_ITEM = 12;

interface EvidenceRow {
  id: string;
  kind: string;
  polarity: string;
  author: string;
  decided_by: string | null;
  owned: number;
  file_path: string | null;
  symbol: string | null;
  ticket: string;
  signal_id: string | null;
  note: string | null;
  at: string;
  fixed_at: string | null;
  disagreed_at: string | null;
}

export function growDashboard(db: Db, opts: { root: string; home?: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const tracks = getTracks(db);
  const ladders = loadActiveLadders(tracks, { repoRoot: opts.root, ...(opts.home ? { home: opts.home } : {}) });
  const results = ladders.map((loaded) => ({ loaded, statuses: computeStatuses(db, loaded, now) }));
  const { areas } = areaViews(results);

  const evidenceFor = db.prepare(
    `SELECT id, kind, polarity, author, decided_by, owned, file_path, symbol, ticket, signal_id, note, at, fixed_at, disagreed_at
     FROM skill_evidence WHERE ladder_id = ? AND item_id = ? ORDER BY at DESC LIMIT ${EVIDENCE_PER_ITEM}`,
  );
  const drillsFor = db.prepare("SELECT id, drill_id, passed, void, created_at FROM drill_attempts WHERE ladder_id = ? AND item_id = ? ORDER BY created_at DESC");

  const dashboardAreas = areas.map((area) => {
    const loaded = ladders.find((l) => l.ladder_id === area.ladder_id)!;
    const statuses = results.find((r) => r.loaded.ladder_id === area.ladder_id)!.statuses;
    return {
      ladder_id: area.ladder_id,
      track: loaded.track,
      area_id: area.area_id,
      name: area.name,
      level: area.level,
      working_toward: area.working_toward,
      exposure: area.exposure,
      items: area.items.map((it) => {
        const status = statuses.get(it.item_id)!;
        const ladderItem = findItem(loaded.ladder, it.item_id)!.item;
        return {
          item_id: it.item_id,
          title: it.title,
          level: it.level,
          state: it.state,
          exposure: it.exposure,
          exposure_functions: status.exposure_functions,
          shown_by: status.shown_by,
          detail: it.detail,
          why_it_matters: ladderItem.why_it_matters ?? "",
          needs: status.needs,
          evidence: (evidenceFor.all(area.ladder_id, it.item_id) as unknown as EvidenceRow[]).map((e) => ({
            id: e.id,
            kind: e.kind,
            polarity: e.polarity,
            author: e.author,
            decided_by: e.decided_by,
            owned: e.owned === 1,
            file: e.file_path,
            symbol: e.symbol,
            ticket: e.ticket,
            signal: e.signal_id,
            note: e.note,
            at: toIso(e.at),
            fixed: e.fixed_at !== null,
            disagreed: e.disagreed_at !== null,
          })),
          drills: (drillsFor.all(area.ladder_id, it.item_id) as { id: string; drill_id: string; passed: number; void: number; created_at: string }[]).map((d) => ({
            id: d.id,
            drill_id: d.drill_id,
            passed: d.passed === 1,
            void: d.void === 1,
            at: toIso(d.created_at),
          })),
        };
      }),
    };
  });

  const windowDays = new Map(ladders.map((l) => [l.ladder_id, l.thresholds.window_days]));
  const allItems = dashboardAreas.flatMap((a) => a.items.map((i) => ({ ...i, area: a.name, window_days: windowDays.get(a.ladder_id) ?? 60 })));
  const open_faults = allItems.flatMap((i) =>
    i.evidence
      // The same rule the state engine uses: not fixed, and inside the window.
      .filter((e) => e.polarity === "negative" && !e.fixed && Date.parse(e.at) >= now.getTime() - i.window_days * 86_400_000)
      .map((e) => ({ item_id: i.item_id, title: i.title, file: e.file, symbol: e.symbol, ticket: e.ticket, owned: e.owned, author: e.author, at: e.at, note: e.note })),
  );
  const ready = new Set(drillsReady(db, results, now));
  const ready_for_assessment = allItems.filter((i) => ready.has(i.item_id) || (i.state === "not_assessed" && (i.exposure === "none" || i.exposure === "low"))).map((i) => i.item_id);

  // What to do next, in order: faults, then drills that are ready, then the first missing step of a learning item.
  const next_actions: string[] = [];
  for (const f of open_faults.slice(0, 2)) next_actions.push(`Fix the open fault in ${f.file ?? "your code"}${f.symbol ? ` (${f.symbol})` : ""}: ${f.title}`);
  for (const id of [...ready].slice(0, 2)) next_actions.push(`Take a drill for ${id}: /devgym:grow drill ${id}`);
  for (const i of allItems.filter((x) => x.state === "learning").slice(0, 2)) if (i.needs[0]) next_actions.push(`${i.item_id}: ${i.needs[0]}`);

  const drill_results = allItems
    .flatMap((i) => i.drills.map((d) => ({ item_id: i.item_id, title: i.title, drill_id: d.drill_id, passed: d.passed, void: d.void, at: d.at })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 20);

  const titles = new Map(allItems.map((i) => [i.item_id, i.title]));
  const history = stateHistory(db)
    .filter((h) => titles.has(h.item_id))
    .map((h) => ({ item_id: h.item_id, title: titles.get(h.item_id)!, from_state: h.from_state, to_state: h.to_state, reason: h.reason, at: h.at }))
    .reverse()
    .slice(0, 30);

  const levelOrder = ["not_seen", "not_assessed", "learning", "shown", "proven"];
  const rank = (s: string) => levelOrder.indexOf(s);
  const recent_changes = history.map((h) => ({ ...h, direction: rank(h.to_state) > rank(h.from_state) ? "up" : "down" }));

  return {
    tracks,
    areas: dashboardAreas,
    repeats: repeats(db, now).map((r) => ({ ...r, title: titles.get(r.item_id) ?? r.item_id })),
    open_faults,
    ready_for_assessment,
    next_actions,
    drill_results,
    recent_changes,
    levels: LEVELS,
  };
}
