import { useState } from "react";
import { Link } from "react-router";
import type { Annotation, CoachReportResponse, EvidenceRef, FocusAreaView } from "@ftc/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { NoteForm } from "../components/NoteForm";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { plural } from "../lib/fork";
import { useTitle } from "../lib/useTitle";

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const dayTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function evidenceHref(ref: EvidenceRef): string {
  return `/paper-trail/${encodeURIComponent(ref.ticket_id)}?decision=${encodeURIComponent(ref.decision_id)}`;
}

function Note({ note }: { note: Annotation }) {
  return (
    <li className={note.disagrees ? "note note--disagrees" : "note"}>
      <p className="note__meta">
        {note.disagrees ? <span className="note__flag">You disagreed</span> : <span>Your note</span>}
        <time dateTime={note.created_at}>{dayTime.format(new Date(note.created_at))}</time>
      </p>
      <p className="note__text">{note.note}</p>
    </li>
  );
}

function FocusArea({ area }: { area: FocusAreaView }) {
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
          <p className="focus__caveat">
            This rests on a single observation. Read it as a question, not a finding.
          </p>
        )}
      </header>

      <section className="focus__evidence" aria-label="Evidence">
        <h3>Based on {plural(area.observations.length, "observation")}</h3>
        <ul className="evidence">
          {area.observations.map((observation) => (
            <li key={observation.id} className="evidence__observation">
              <p>{observation.summary}</p>
              <ul className="evidence__refs">
                {observation.evidence.map((ref) => (
                  <li key={ref.id}>
                    <span className="evidence__kind">{ref.kind === "decision" ? "Decision" : "Explain-back"}</span>
                    <Link to={evidenceHref(ref)}>{ref.label}</Link>
                  </li>
                ))}
                {observation.evidence.length === 0 && (
                  <li className="evidence__missing">The decisions behind this observation are no longer stored.</li>
                )}
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
        <NoteForm targetId={area.target_id} onSaved={(note) => setAdded((list) => [...list, note])} />
      </section>
    </li>
  );
}

function Report({ report }: { report: CoachReportResponse }) {
  const plan = report.plan;
  if (!plan) {
    return (
      <EmptyState title="No growth plan yet">
        <p>
          Coach builds a plan from your explain-backs. Once you have explained a few decisions, run{" "}
          <code>/ftc:coach</code> in Claude Code and the plan will appear here.
        </p>
      </EmptyState>
    );
  }
  const tentative = plan.focus_areas.filter((area) => area.tentative).length;
  return (
    <>
      <p className="summary__line">
        Your plan from {day.format(new Date(plan.created_at))} has {plural(plan.focus_areas.length, "focus area")}
        {tentative > 0 ? `, ${tentative} of them tentative` : ""}. Every claim links to the decisions it is
        based on. If one is wrong, say so: your notes are kept with the plan.
      </p>
      <ul className="focus-list">
        {plan.focus_areas.map((area) => (
          <FocusArea key={area.target_id} area={area} />
        ))}
      </ul>
    </>
  );
}

/** FE-5: the growth plan, with evidence links and the developer's own notes. */
export function CoachPage() {
  useTitle("Coach");
  const report = useApi("coach", (signal) => api.getCoachReport(signal));

  return (
    <article className="coach-page">
      <h1 className="page-title">Coach</h1>
      {report.status === "loading" && <Loading what="your growth plan" />}
      {report.status === "error" && <ErrorState error={report.error} what="your growth plan" />}
      {report.status === "ready" && <Report report={report.data} />}
    </article>
  );
}
