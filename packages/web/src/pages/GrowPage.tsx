import { useState } from "react";
import { Link } from "react-router";
import {
  DECISION_ORIGIN_LABEL,
  EXPLAIN_BACK_RATING_LABEL,
  type Annotation,
  type EvidenceItem,
  type FocusArea as FocusAreaData,
  type GrowthPlan,
} from "@devgym/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { NoteForm } from "../components/NoteForm";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { formatDay, formatDayTime, isoDate } from "../lib/dates";
import { plural } from "../lib/clarify";
import { useTitle } from "../lib/useTitle";
import { GrowthSection } from "./GrowthSection";

/** Words for each decision and explanation the plan cites, read from the tickets they belong to. */
type Labels = Map<string, string>;

async function loadReport(signal: AbortSignal): Promise<{ plan: GrowthPlan | null; labels: Labels }> {
  const { growth_plan: plan } = await api.getGrowthPlan(signal);
  const labels: Labels = new Map();
  if (!plan) return { plan, labels };
  const tickets = new Set(
    plan.focus_areas.flatMap((a) => a.evidence.flatMap((o) => o.evidence.map((e) => e.ticket_id))).filter(Boolean) as string[],
  );
  // A ticket that cannot be read only costs the label; the link and the rest of the plan still work.
  await Promise.all(
    [...tickets].map(async (id) => {
      try {
        const detail = await api.getTicket(id, signal);
        for (const d of detail.decisions) {
          labels.set(d.id, d.summary);
          for (const e of d.explain_backs) labels.set(e.id, e.question);
        }
      } catch {
        // Labels stay empty for this ticket.
      }
    }),
  );
  return { plan, labels };
}

function evidenceDetail(item: EvidenceItem): string {
  if (item.kind === "decision") return item.origin ? `made by ${DECISION_ORIGIN_LABEL[item.origin]}` : "";
  if (item.kind === "explain_back") return item.rating ? `rated ${EXPLAIN_BACK_RATING_LABEL[item.rating]}` : "";
  return "";
}

function Evidence({ item, labels }: { item: EvidenceItem; labels: Labels }) {
  if (item.kind === "missing" || !item.ticket_id) {
    return <li className="evidence__missing">This piece of evidence was deleted after the observation was made.</li>;
  }
  const kind = item.kind === "decision" ? "Decision" : "Explain";
  const label = labels.get(item.id) ?? `${kind} on ${item.ticket_id}`;
  const detail = evidenceDetail(item);
  return (
    <li>
      <span className="evidence__kind">{kind}</span>
      <span>
        <Link to={`/track/${encodeURIComponent(item.ticket_id)}?item=${encodeURIComponent(item.id)}`}>{label}</Link>
        {detail && <span className="evidence__detail"> ({detail})</span>}
      </span>
    </li>
  );
}

function Note({ note }: { note: Annotation }) {
  return (
    <li className={note.disagrees ? "note note--disagrees" : "note"}>
      <p className="note__meta">
        {note.disagrees ? <span className="note__flag">You disagreed</span> : <span>Your note</span>}
        <time dateTime={isoDate(note.created_at)}>{formatDayTime(note.created_at)}</time>
      </p>
      <p className="note__text">{note.note}</p>
    </li>
  );
}

function FocusArea({ area, labels }: { area: FocusAreaData; labels: Labels }) {
  // Notes saved in this visit show at once; after a reload they come from the store.
  const [added, setAdded] = useState<Annotation[]>([]);
  const notes = [...area.annotations, ...added.filter((a) => !area.annotations.some((n) => n.id === a.id))];
  const disagreed = notes.some((note) => note.disagrees);

  return (
    <li className={area.tentative ? "focus focus--tentative" : "focus"}>
      <header className="focus__head">
        {(area.tentative || disagreed) && (
          <p className="focus__flags">
            {area.tentative && <span className="tag tag--tentative">tentative</span>}
            {disagreed && <span className="tag tag--disagreed">you disagreed</span>}
          </p>
        )}
        <h2 className="focus__claim">{area.claim}</h2>
        {area.tentative && (
          <p className="focus__caveat">This rests on a single observation. Read it as a question, not a finding.</p>
        )}
      </header>

      <section className="focus__evidence" aria-label="Evidence">
        <h3>Based on {plural(area.evidence.length, "observation")}</h3>
        <ul className="evidence">
          {area.evidence.map((observation) => (
            <li key={observation.id} className="evidence__observation">
              <p>{observation.summary}</p>
              <ul className="evidence__refs">
                {observation.evidence.map((item) => (
                  <Evidence key={item.id} item={item} labels={labels} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="focus__exercise" aria-label="Exercise">
        <h3>Try this</h3>
        <p>{area.exercise}</p>
      </section>

      <section className="focus__notes" aria-label="Your notes">
        {notes.length > 0 && (
          <ul className="notes">
            {notes.map((note) => (
              <Note key={note.id} note={note} />
            ))}
          </ul>
        )}
        <NoteForm targetId={area.id} onSaved={(note) => setAdded((list) => [...list, note])} />
      </section>
    </li>
  );
}

function Report({ plan, labels }: { plan: GrowthPlan | null; labels: Labels }) {
  if (!plan) {
    return (
      <EmptyState title="No growth plan yet">
        <p>
          Grow builds a plan from your explanations. Once you have explained a few decisions, run{" "}
          <code>/devgym:grow</code> in Claude Code and the plan will appear here.
        </p>
      </EmptyState>
    );
  }
  const tentative = plan.focus_areas.filter((area) => area.tentative).length;
  return (
    <>
      <p className="summary__line coach__summary">
        Your plan from {formatDay(plan.created_at)} has {plural(plan.focus_areas.length, "focus area")}
        {tentative > 0 ? `, ${tentative} of them tentative` : ""}. Every claim links to the decisions it is based on.
        If one is wrong, say so: your notes are kept with the plan.
      </p>
      <ul className="focus-list">
        {plan.focus_areas.map((area) => (
          <FocusArea key={area.id} area={area} labels={labels} />
        ))}
      </ul>
    </>
  );
}

/** FE-5: the growth plan, with evidence links and the developer's own notes. */
export function GrowPage() {
  useTitle("Grow");
  const report = useApi("grow", loadReport);

  return (
    <article className="grow-page">
      <GrowthSection />
      <div className="section-head section-head--plan">
        <h2>Your plan</h2>
        <p>A short list, built from your own evidence. Every claim links to where it came from.</p>
      </div>
      {report.status === "loading" && <Loading what="your growth plan" />}
      {report.status === "error" && <ErrorState error={report.error} what="your growth plan" />}
      {report.status === "ready" && <Report plan={report.data.plan} labels={report.data.labels} />}
    </article>
  );
}
