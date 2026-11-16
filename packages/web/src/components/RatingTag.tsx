import { EXPLAIN_BACK_RATING_LABEL, type ExplainBackRating } from "@ftc/shared";

const DESCRIPTION: Record<ExplainBackRating, string> = {
  clear: "The developer explained the decision clearly",
  partial: "The developer explained part of the decision",
  not_yet: "The developer could not explain the decision yet",
};

/** How well a decision was explained back: clear, partial, or not yet. */
export function RatingTag({ rating }: { rating: ExplainBackRating }) {
  return (
    <span className={`rating rating--${rating}`} title={DESCRIPTION[rating]}>
      {EXPLAIN_BACK_RATING_LABEL[rating]}
    </span>
  );
}
