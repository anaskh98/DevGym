import type { CSSProperties } from "react";
import type { EvalResults, EvalScore } from "@ftc/shared";
import { api } from "../api/client";
import { apiConfig } from "../api/config";
import { useApi } from "../api/useApi";
import { formatDayTime } from "../lib/dates";
import { EmptyState, ErrorState, Loading } from "../components/States";
import { plural } from "../lib/fork";
import { AREA_LABEL, isMeasured, missed, orderedScores, scoreText, sortedFailures } from "../lib/eval";
import { useTitle } from "../lib/useTitle";


/** One cell per item counted: filled when it passed. Too many items to draw becomes a plain bar. */
function ScoreCells({ score }: { score: EvalScore }) {
  if (!isMeasured(score)) return null;
  if (score.total > 24) {
    return (
      <div className="score__meter" aria-hidden="true">
        <span style={{ width: `${(score.passed / score.total) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="score__cells" aria-hidden="true">
      {Array.from({ length: score.total }, (_, index) => (
        <span key={index} className={index < score.passed ? "score__cell score__cell--pass" : "score__cell"} />
      ))}
    </div>
  );
}

/** A ring that fills to the share that passed. The words beside it carry the same number. */
function Gauge({ passed, total, className = "gauge" }: { passed: number; total: number; className?: string }) {
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  return (
    <div className={className} style={{ "--pct": pct } as CSSProperties} aria-hidden="true">
      <span>{pct}%</span>
    </div>
  );
}

function ScoreRow({ score }: { score: EvalScore }) {
  const measured = isMeasured(score);
  return (
    <li className={measured ? "score" : "score score--not-run"}>
      <div className="score__top">
        <h3 className="score__label">{score.label}</h3>
        {measured && <Gauge passed={score.passed} total={score.total} />}
      </div>
      <p className="score__value">{scoreText(score)}</p>
      <div className="score__detail">
        <p className="score__measures">
          {measured ? score.measures : (score.note ?? "This part of the evaluation has not been run.")}
        </p>
        <ScoreCells score={score} />
        {measured && score.also.length > 0 && (
          <p className="score__also">
            {score.also.map((item) => `${item.value} ${item.label}`).join(", ")}
          </p>
        )}
        {measured && score.note && <p className="score__also">{score.note}</p>}
      </div>
    </li>
  );
}

function Results({ results }: { results: EvalResults }) {
  const scores = orderedScores(results);
  const failures = sortedFailures(results.failures);
  const totalMissed = scores.reduce((sum, score) => sum + missed(score), 0);
  const overall = scores.filter(isMeasured).reduce(
    (sum, score) => ({ passed: sum.passed + score.passed, total: sum.total + score.total }),
    { passed: 0, total: 0 },
  );

  return (
    <>
      {apiConfig.mode === "mock" && (
        <p className="sample-banner" role="note">
          These numbers are made up to show the page. They are not from a real evaluation run.
        </p>
      )}
      <section className="eval__hero" aria-label="Overall">
        <div>
          <p className="eval__hero-label">Overall</p>
          <p className="eval__hero-value">
            {overall.total > 0 ? `${overall.passed} of ${overall.total} passed` : "Nothing measured yet"}
          </p>
          <p className="summary__line">
            Run on {formatDayTime(results.run_at)}, on ticket {results.ticket_id}. Fork was run{" "}
            {plural(results.fork_runs, "time")}.
          </p>
        </div>
        {overall.total > 0 && <Gauge passed={overall.passed} total={overall.total} className="gauge gauge--hero" />}
      </section>

      <section aria-labelledby="scores-heading">
        <h2 id="scores-heading" className="eval__heading">
          The five scores
        </h2>
        <ul className="scores">
          {scores.map((score) => (
            <ScoreRow key={score.id} score={score} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="failures-heading">
        <h2 id="failures-heading" className="eval__heading">
          Where it failed
        </h2>
        {failures.length === 0 ? (
          <p className="eval__none">
            {totalMissed === 0
              ? "No failures were recorded in this run."
              : `The scores show ${plural(totalMissed, "miss", "misses")}, but the results file lists none of them.`}
          </p>
        ) : (
          <div className="failures" role="region" aria-labelledby="failures-heading" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  <th scope="col">What went wrong</th>
                  <th scope="col">Expected</th>
                  <th scope="col">What happened</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((failure) => (
                  <tr key={failure.id}>
                    <th scope="row">
                      {AREA_LABEL[failure.area]}
                      {failure.run !== null && <span className="failures__run">run {failure.run}</span>}
                    </th>
                    <td data-label="What went wrong">{failure.what}</td>
                    <td data-label="Expected">{failure.expected}</td>
                    <td data-label="What happened">{failure.got}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/** FE-7: the five scores and the failure log, read from the eval results file. */
export function EvalPage() {
  useTitle("Eval");
  const results = useApi("eval", (signal) => api.getEvalResults(signal));

  return (
    <article className="eval-page">
      <h1 className="page-title">Eval</h1>
      {results.status === "loading" && <Loading what="the evaluation results" />}
      {results.status === "error" &&
        (results.error.kind === "not_found" ? (
          <EmptyState title="No evaluation has been run">
            <p>
              Run <code>pnpm eval</code> in the plugin repository. It scores the saved Fork runs against the
              answer key, checks the pointers, and red-teams the privacy guard, then writes the results this
              page shows.
            </p>
          </EmptyState>
        ) : (
          <ErrorState error={results.error} what="the evaluation results" />
        ))}
      {results.status === "ready" && <Results results={results.data} />}
    </article>
  );
}
