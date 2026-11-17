import type { ExplainBack } from "@ftc/shared";
import { RatingTag } from "./RatingTag";

/**
 * What the developer said when asked to explain a decision (FE-4).
 * It sits under the decision it belongs to, so the link between the two is
 * the layout itself.
 */
export function ExplainBackPanel({ explainBack }: { explainBack: ExplainBack }) {
  return (
    <section id={explainBack.id} className={`explain explain--${explainBack.rating}`} aria-label="Explain-back">
      <p className="explain__head">
        <span className="explain__label">Explained back</span>
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
