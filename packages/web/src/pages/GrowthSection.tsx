import type { GrowArea, GrowDashboard, GrowExposure, GrowItem, GrowState } from "@devgym/shared";
import type { ReactNode } from "react";
import { api } from "../api/client";
import { useApi } from "../api/useApi";
import { Icon } from "../components/Icon";
import { ErrorState } from "../components/States";
import { formatDay, isoDate } from "../lib/dates";
import { EXPOSURE_LABEL, STATE_HINT, STATE_LABEL, evidenceLine, exposureBars, ladderSteps, levelText, masteryFill, stateCounts, visibleItems } from "../lib/grow";

const day = (iso: string) => formatDay(isoDate(iso));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puts `/devgym:...` commands in a code style, so the developer can see what to type. */
function withCommands(text: string): ReactNode {
  return text.split(/(\/devgym:[\w:-]+(?: [\w.<>-]+)*)/g).map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}

/* ---- Small pieces ---------------------------------------------------------- */

function Badge({ state, by }: { state: GrowState; by?: GrowItem["shown_by"] }) {
  return (
    <span className={`badge badge--${state}`} title={STATE_HINT[state]}>
      {STATE_LABEL[state]}
      {state === "shown" && by === "drill" ? " · by drills" : ""}
    </span>
  );
}

/** Three segments: Learning, Shown, Proven. The words carry the meaning; the colour only helps. */
function Mastery({ state }: { state: GrowState }) {
  const fill = masteryFill(state);
  return (
    <span className={`mastery mastery--${state}`} role="img" aria-label={`Mastery: ${STATE_LABEL[state]}`}>
      {[1, 2, 3].map((n) => (
        <span key={n} className={n <= fill ? "mastery__seg is-on" : "mastery__seg"} />
      ))}
    </span>
  );
}

function ExposureMeter({ level, label = true }: { level: GrowExposure; label?: boolean }) {
  const bars = exposureBars(level);
  return (
    <span className="exposure" title="How much your work gave you a chance to use this skill. Low is never a weakness.">
      <span className="exposure__bars" role="img" aria-label={EXPOSURE_LABEL[level]}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= bars ? "exposure__bar is-on" : "exposure__bar"} />
        ))}
      </span>
      {label && <span className="exposure__text">{EXPOSURE_LABEL[level]}</span>}
    </span>
  );
}

function Ladder({ area }: { area: GrowArea }) {
  return (
    <ol className="ladder" aria-label={`Ladder: ${levelText(area)}`}>
      {ladderSteps(area).map((step) => (
        <li key={step.level} className={`ladder__step ladder__step--${step.status}`} aria-current={step.status === "current" ? "step" : undefined}>
          <span className="ladder__dot">{step.status === "done" ? <Icon name="check" className="icon icon--sm" /> : null}</span>
          <span className="ladder__label">{cap(step.level)}</span>
        </li>
      ))}
    </ol>
  );
}

/* ---- Hero ------------------------------------------------------------------ */

const HERO_TILES: { state: GrowState; label: string }[] = [
  { state: "proven", label: "Proven" },
  { state: "shown", label: "Shown" },
  { state: "learning", label: "Learning" },
  { state: "not_assessed", label: "Not assessed" },
];

function Hero({ data }: { data: GrowDashboard | null }) {
  const counts = data ? stateCounts(data.areas) : null;
  return (
    <header className="grow-hero">
      <div className="grow-hero__text">
        <p className="grow-hero__eyebrow">
          <Icon name="spark" className="icon icon--sm" /> Your growth, from your own work
        </p>
        <h1 className="grow-hero__title">Grow</h1>
        <p className="grow-hero__lede">
          Where you stand on each skill, what your work has shown, and the one thing to do next. Everything here stays on this computer.
        </p>
        {data && data.tracks.length > 0 && (
          <p className="grow-hero__chips">
            {data.tracks.map((t) => (
              <span key={t} className="chip chip--onDark">
                {cap(t)}
              </span>
            ))}
          </p>
        )}
      </div>
      <ul className="stat-tiles" aria-label="Skills by state">
        {HERO_TILES.map((tile) => (
          <li key={tile.state} className={`stat-tile stat-tile--${tile.state}`}>
            <span className="stat-tile__num">{counts ? counts[tile.state] : "–"}</span>
            <span className="stat-tile__label">{tile.label}</span>
          </li>
        ))}
      </ul>
    </header>
  );
}

/* ---- Sections -------------------------------------------------------------- */

function SectionHead({ title, hint, id }: { title: string; hint?: string; id?: string }) {
  return (
    <div className="section-head">
      <h2 id={id}>{title}</h2>
      {hint && <p>{hint}</p>}
    </div>
  );
}

function NextSteps({ actions }: { actions: string[] }) {
  return (
    <section aria-labelledby="next-title">
      <SectionHead id="next-title" title="Do this next" hint="The few things that move you forward most." />
      {actions.length === 0 ? (
        <p className="calm">
          <Icon name="check" className="icon icon--sm" /> Nothing urgent. Keep working as usual: Grow keeps reading your commits in the background.
        </p>
      ) : (
        <ol className="next-list">
          {actions.map((a, i) => (
            <li key={a} className="next-card">
              <span className="next-card__num">{i + 1}</span>
              <p>{withCommands(a)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Skill({ item }: { item: GrowItem }) {
  const faults = item.evidence.filter((e) => e.polarity === "negative" && !e.fixed).length;
  return (
    <li className={`skill skill--${item.state}`}>
      <details>
        <summary>
          <span className="skill__main">
            <span className="skill__id">{item.item_id}</span>
            <span className="skill__title">{item.title}</span>
            <span className="skill__detail">{withCommands(item.detail)}</span>
          </span>
          <span className="skill__meta">
            <Badge state={item.state} by={item.shown_by} />
            <Mastery state={item.state} />
            <ExposureMeter level={item.exposure} />
            {faults > 0 && (
              <span className="skill__fault">
                <Icon name="flag" className="icon icon--sm" /> {faults} open {faults === 1 ? "fault" : "faults"}
              </span>
            )}
          </span>
          <Icon name="chevron" className="icon skill__chev" />
        </summary>

        <div className="skill__body">
          {item.why_it_matters && (
            <p className="callout">
              <strong>Why it matters.</strong> {item.why_it_matters}
            </p>
          )}
          <p className="skill__hint">{STATE_HINT[item.state]}</p>

          {item.needs.length > 0 && (
            <section className="skill__block">
              <h4>What is missing</h4>
              <ul className="checklist">
                {item.needs.map((n) => (
                  <li key={n}>{withCommands(n)}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="skill__block">
            <h4>Evidence</h4>
            {item.evidence.length === 0 ? (
              <p className="muted">No evidence yet.</p>
            ) : (
              <ul className="timeline">
                {item.evidence.map((e) => (
                  <li key={e.id} className={`timeline__item ${e.polarity === "negative" ? (e.fixed ? "is-fixed" : "is-fault") : "is-proof"}`}>
                    <span className="timeline__kind">{e.polarity === "negative" ? (e.fixed ? "Fixed fault" : "Open fault") : "Proof"}</span>
                    <span className="timeline__text">
                      {evidenceLine(e)}
                      {e.disagreed ? " · you disagreed (kept)" : ""}
                    </span>
                    <time className="timeline__date" dateTime={e.at}>
                      {day(e.at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {item.drills.length > 0 && (
            <section className="skill__block">
              <h4>Drills</h4>
              <ul className="chips">
                {item.drills.map((d) => (
                  <li key={d.id} className={`chip ${d.void ? "chip--void" : d.passed ? "chip--pass" : "chip--fail"}`}>
                    {d.void ? "Void" : d.passed ? "Passed" : "Not passed"} · {day(d.at)}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </details>
    </li>
  );
}

function AreaCard({ area }: { area: GrowArea }) {
  return (
    <section className="area-card" aria-label={area.name}>
      <header className="area-card__head">
        <div>
          <p className="area-card__track">{area.track === "backend" ? "Backend" : "Frontend"}</p>
          <h3>{area.name}</h3>
          <p className="area-card__level">{levelText(area)}</p>
        </div>
        <div className="area-card__gauges">
          <Ladder area={area} />
          <p className="area-card__exposure">
            <span>Exposure in this area</span>
            <ExposureMeter level={area.exposure} />
          </p>
        </div>
      </header>
      <ul className="skills">
        {visibleItems(area).map((i) => (
          <Skill key={i.item_id} item={i} />
        ))}
      </ul>
    </section>
  );
}

function InsightCard({ icon, title, count, tone, children, empty }: { icon: "repeat" | "flag" | "bolt"; title: string; count: number; tone: "warn" | "danger" | "good"; children: ReactNode; empty: string }) {
  return (
    <section className={`insight insight--${tone}`} aria-label={title}>
      <header>
        <span className="insight__icon">
          <Icon name={icon} />
        </span>
        <h3>{title}</h3>
        <span className="insight__count">{count}</span>
      </header>
      {count === 0 ? <p className="muted">{empty}</p> : children}
    </section>
  );
}

function Insights({ data }: { data: GrowDashboard }) {
  return (
    <section aria-labelledby="insights-title">
      <SectionHead id="insights-title" title="Watch list" hint="Habits to break, faults still open, and skills ready to be tested." />
      <div className="insights">
        <InsightCard icon="repeat" title="Recurring weaknesses" tone="warn" count={data.repeats.length} empty="No mistake has come back on 3 tickets. Good.">
          <ul>
            {data.repeats.map((r) => (
              <li key={`${r.item_id}:${r.signal_id}`}>
                <strong>{r.title}</strong>
                <span>
                  {r.times} times on {r.tickets} tickets{r.shipped > 0 ? `, ${r.shipped} reached main as bugs` : ""}
                </span>
                <em className={r.coming_back ? "is-bad" : "is-good"}>{r.coming_back ? `Last: ${day(r.last_at)}` : "Nothing new in 60 days: a fixed habit?"}</em>
              </li>
            ))}
          </ul>
        </InsightCard>
        <InsightCard icon="flag" title="Outstanding faults" tone="danger" count={data.open_faults.length} empty="No open faults. Nice.">
          <ul>
            {data.open_faults.map((f, i) => (
              <li key={i}>
                <strong>{f.title}</strong>
                <span>
                  {f.file ?? "your code"}
                  {f.symbol ? ` (${f.symbol})` : ""} · ticket {f.ticket}
                </span>
                {f.owned && <em className="is-bad">Written by the AI, owned by you</em>}
              </li>
            ))}
          </ul>
        </InsightCard>
        <InsightCard icon="bolt" title="Ready for a drill" tone="good" count={data.ready_for_assessment.length} empty="No drill is ready yet. Keep going.">
          <ul>
            {data.ready_for_assessment.map((id) => (
              <li key={id}>
                <strong>{id}</strong>
                <span>
                  Run <code>{`/devgym:grow drill ${id}`}</code>
                </span>
              </li>
            ))}
          </ul>
        </InsightCard>
      </div>
    </section>
  );
}

function History({ data }: { data: GrowDashboard }) {
  if (data.recent_changes.length === 0 && data.drill_results.length === 0) return null;
  return (
    <section aria-labelledby="history-title">
      <SectionHead id="history-title" title="Progress over time" hint="Every change is explained, and links to its evidence above." />
      <div className="history">
        <div className="panel-card">
          <h3>Improvements and regressions</h3>
          {data.recent_changes.length === 0 ? (
            <p className="muted">No changes yet.</p>
          ) : (
            <ul className="steps">
              {data.recent_changes.slice(0, 8).map((c, i) => (
                <li key={i} className={`steps__item ${c.direction === "down" ? "is-down" : "is-up"}`}>
                  <span className="steps__dot" aria-hidden="true">
                    {c.direction === "up" ? "▲" : "▼"}
                  </span>
                  <div>
                    <p>
                      <strong>{c.title}</strong>
                    </p>
                    <p className="steps__move">
                      {c.from_state.replace("_", " ")} → {c.to_state.replace("_", " ")}
                    </p>
                    <p className="muted">
                      {c.reason} · {day(c.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel-card">
          <h3>Completed drills</h3>
          {data.drill_results.length === 0 ? (
            <p className="muted">No drills taken yet.</p>
          ) : (
            <ul className="steps">
              {data.drill_results.slice(0, 8).map((d, i) => (
                <li key={i} className={`steps__item ${d.void ? "is-void" : d.passed ? "is-up" : "is-down"}`}>
                  <span className="steps__dot" aria-hidden="true">
                    {d.void ? "–" : d.passed ? "✓" : "✕"}
                  </span>
                  <div>
                    <p>
                      <strong>{d.title}</strong>
                    </p>
                    <p className="steps__move">{d.void ? "void" : d.passed ? "passed" : "not passed"}</p>
                    <p className="muted">
                      {d.item_id} · {day(d.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Onboarding() {
  return (
    <section className="onboarding" aria-label="Get started">
      <h2>Start in three steps</h2>
      <ol>
        <li>
          <span>1</span>
          <p>
            In Claude Code, run <code>/devgym:grow</code> once and choose backend, frontend, or both.
          </p>
        </li>
        <li>
          <span>2</span>
          <p>Work as you always do. Grow reads your commits quietly in the background. Nothing blocks your work.</p>
        </li>
        <li>
          <span>3</span>
          <p>Come back here to see your levels, the evidence behind them, and what to practise next.</p>
        </li>
      </ol>
    </section>
  );
}

function Growth({ data }: { data: GrowDashboard }) {
  if (data.areas.length === 0) return <Onboarding />;
  return (
    <>
      <NextSteps actions={data.next_actions} />
      <section aria-labelledby="skills-title">
        <SectionHead id="skills-title" title="Your skills" hint="Open a skill to see why it matters, what is missing, and the evidence." />
        <div className="areas">
          {data.areas.map((a) => (
            <AreaCard key={`${a.ladder_id}:${a.area_id}`} area={a} />
          ))}
        </div>
        <p className="legend">
          <strong>Proficiency</strong> is what you have shown. <strong>Exposure</strong> is how much your work gave you a chance to show it. A skill your
          work rarely touches is <em>not assessed</em>, never a weakness.
        </p>
      </section>
      <Insights data={data} />
      <History data={data} />
    </>
  );
}

/** The growth dashboard: hero, next steps, skills by area, watch list and history. */
export function GrowthSection() {
  const growth = useApi("grow-growth", (signal: AbortSignal) => api.getGrow(signal));
  const data = growth.status === "ready" ? growth.data : null;
  return (
    <div className="grow-dash">
      <Hero data={data} />
      {growth.status === "loading" && (
        <div className="skeleton" aria-busy="true" aria-live="polite">
          <span className="skeleton__bar" />
          <span className="skeleton__bar" />
          <span className="skeleton__bar skeleton__bar--short" />
          <span className="visually-hidden">Loading your growth</span>
        </div>
      )}
      {growth.status === "error" && <ErrorState error={growth.error} what="your levels" />}
      {data && <Growth data={data} />}
    </div>
  );
}
