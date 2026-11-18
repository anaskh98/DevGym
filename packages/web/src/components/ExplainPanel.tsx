import type { ExplainBack } from "@devgym/shared";
import { RatingTag } from "./RatingTag";

/**
 * What the developer said when asked to explain a decision (FE-4).
 * It sits under the decision it belongs to, so the link between the two is
 * the layout itself.
 */
export function ExplainPanel({ explainBack }: { explainBack: ExplainBack }) {
  return (
    <section id={explainBack.id} className={`explain explain--${explainBack.rating}`} aria-label="Explain">
      <p className="explain__head">
        <span className="explain__label">Explanation</span>
        <RatingTag rating={explainBack.rating} />
      </p>
      <p className="explain__question">{explainBack.question}</p>
      <blockquote className="explain__answer">
        <span className="visually-hidden">The developer answered: </span>
        {explainBack.answer}
      </blockquote>
    </section>
  );
}
