import type { GrowArea, GrowDashboard, GrowItem } from "@devgym/shared";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { formatDay, isoDate } from "../lib/dates";
import { EXPOSURE_LABEL, STATE_HINT, STATE_LABEL, evidenceLine, levelText, visibleItems } from "../lib/grow";
import { ErrorState, Loading } from "../components/States";

const day = (iso: string) => formatDay(isoDate(iso));

function StateTag({ item }: { item: Pick<GrowItem, "state" | "shown_by"> }) {
  return (
    <span className={`tag tag--state-${item.state}`} title={STATE_HINT[item.state]}>
      {STATE_LABEL[item.state]}
      {item.state === "shown" && item.shown_by === "drill" ? " (by drills)" : ""}
    </span>
  );
}

function Item({ item }: { item: GrowItem }) {
  return (
    <li className="growth-item">
      <details>
        <summary>
          <span className="growth-item__id">{item.item_id}</span> {item.title} <StateTag item={item} />{" "}
          <span className={`tag tag--exposure-${item.exposure}`}>{EXPOSURE_LABEL[item.exposure]}</span>
          <span className="growth-item__detail">{item.detail}</span>
        </summary>
        {item.why_it_matters && <p className="growth-item__why">Why it matters: {item.why_it_matters}</p>}
        <p className="growth-item__hint">{STATE_HINT[item.state]}</p>
        {item.needs.length > 0 && (
          <>
            <h4>What is missing</h4>
            <ul>
              {item.needs.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <h4>Evidence</h4>
        {item.evidence.length === 0 ? (
          <p>No evidence yet.</p>
        ) : (
          <ul>
            {item.evidence.map((e) => (
              <li key={e.id} className={e.polarity === "negative" ? "evidence--fault" : ""}>
                {e.polarity === "negative" ? (e.fixed ? "Fixed fault: " : "Open fault: ") : "Proof: "}
                {evidenceLine(e)} · {day(e.at)}
                {e.disagreed ? " · you disagreed (kept)" : ""}
              </li>
            ))}
          </ul>
        )}
        {item.drills.length > 0 && (
          <>
            <h4>Drills</h4>
            <ul>
              {item.drills.map((d) => (
                <li key={d.id}>
                  {d.void ? "Void" : d.passed ? "Passed" : "Not passed"} · {day(d.at)}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </li>
  );
}

function Area({ area }: { area: GrowArea }) {
  return (
    <section className="growth-area" aria-label={area.name}>
      <h3>
        {area.track === "backend" ? "Backend" : "Frontend"} · {area.name}
      </h3>
      <p className="growth-area__level">
        Level: <strong>{levelText(area)}</strong> · <span className={`tag tag--exposure-${area.exposure}`}>{EXPOSURE_LABEL[area.exposure]}</span>
      </p>
      <ul className="growth-items">
        {visibleItems(area).map((i) => (
          <Item key={i.item_id} item={i} />
        ))}
      </ul>
    </section>
  );
}

function Growth({ data }: { data: GrowDashboard }) {
  if (data.areas.length === 0) {
    return (
      <p className="summary__line">
        Grow has no levels for you yet. Run <code>/devgym:grow</code> once in Claude Code and choose backend, frontend or both. After
        that it keeps up on its own.
      </p>
    );
  }
  return (
    <>
      <p className="summary__line">
        Proficiency and exposure are separate. A skill your work rarely touches is <em>not assessed</em>, never a weakness. Every state links to
        its evidence.
      </p>
      {data.next_actions.length > 0 && (
        <section aria-label="Next learning actions">
          <h3>Recommended next</h3>
          <ul>
            {data.next_actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      )}
      {data.areas.map((a) => (
        <Area key={`${a.ladder_id}:${a.area_id}`} area={a} />
      ))}
      {data.repeats.length > 0 && (
        <section aria-label="Recurring weaknesses">
          <h3>Recurring weaknesses</h3>
          <ul>
            {data.repeats.map((r) => (
              <li key={`${r.item_id}:${r.signal_id}`}>
                {r.item_id} {r.title}: {r.times} times on {r.tickets} tickets
                {r.shipped > 0 ? `, ${r.shipped} reached main as bugs` : ""} ·{" "}
                {r.coming_back ? `last ${day(r.last_at)}` : "nothing new in 60 days: a fixed habit?"}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.open_faults.length > 0 && (
        <section aria-label="Outstanding faults">
          <h3>Outstanding faults</h3>
          <ul>
            {data.open_faults.map((f, i) => (
              <li key={i}>
                {f.item_id}: {f.note ?? f.title} · {f.file ?? "your code"}
                {f.symbol ? ` (${f.symbol})` : ""} · ticket {f.ticket}
                {f.owned ? " · written by the AI, owned by you" : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.ready_for_assessment.length > 0 && (
        <section aria-label="Ready for assessment">
          <h3>Ready for a drill</h3>
          <p>
            {data.ready_for_assessment.join(", ")}. Start one with <code>/devgym:grow drill &lt;item&gt;</code>.
          </p>
        </section>
      )}
      {data.recent_changes.length > 0 && (
        <section aria-label="Recent changes">
          <h3>Recent improvements and regressions</h3>
          <ul>
            {data.recent_changes.slice(0, 10).map((c, i) => (
              <li key={i} className={c.direction === "down" ? "change--down" : "change--up"}>
                {c.direction === "up" ? "▲" : "▼"} {c.item_id} {c.title}: {c.from_state.replace("_", " ")} → {c.to_state.replace("_", " ")} · {c.reason} · {day(c.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.drill_results.length > 0 && (
        <section aria-label="Completed drills">
          <h3>Completed drills</h3>
          <ul>
            {data.drill_results.map((d, i) => (
              <li key={i}>
                {d.item_id} {d.title}: {d.void ? "void" : d.passed ? "passed" : "not passed"} · {day(d.at)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The growth dashboard: levels per area, exposure apart from proficiency, and the evidence behind every state. */
export function GrowthSection() {
  const growth = useApi("grow-growth", (signal: AbortSignal) => api.getGrow(signal));
  return (
    <section className="growth" aria-label="Your growth">
      <h2>Your growth</h2>
      {growth.status === "loading" && <Loading what="your levels" />}
      {growth.status === "error" && <ErrorState error={growth.error} what="your levels" />}
      {growth.status === "ready" && <Growth data={growth.data} />}
    </section>
  );
}
