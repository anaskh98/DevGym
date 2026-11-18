import type { Decision as DecisionView } from "@ftc/shared";
import { formatTime, isoDate } from "../lib/dates";
import { ExplainBackPanel } from "./ExplainBackPanel";
import { OriginBadge } from "./OriginBadge";
import { PointerLink } from "./PointerLink";


/**
 * One decision on the trail: who made it, what was decided, what was not
 * taken, and where it lives in the code.
 */
export function DecisionItem({ decision, highlighted = false }: { decision: DecisionView; highlighted?: boolean }) {
  return (
    <li
      id={decision.id}
      className={`decision decision--${decision.origin}${highlighted ? " decision--highlighted" : ""}`}
    >
      <time className="decision__time" dateTime={isoDate(decision.created_at)}>
        {formatTime(decision.created_at)}
      </time>
      <div className="decision__body">
        <div className="decision__card">
          <p className="decision__origin">
            <OriginBadge origin={decision.origin} />
            {highlighted && <span className="decision__linked">Linked from your growth plan</span>}
          </p>
          <h3 className="decision__summary">{decision.summary}</h3>

          {decision.alternatives.length > 0 && (
            <ul className="decision__alternatives" aria-label="Not taken">
              {decision.alternatives.map((alternative, index) => (
                <li key={index}>
                  <span className="decision__not">Not taken:</span>
                  {alternative}
                </li>
              ))}
            </ul>
          )}

          <p className="decision__where">
            {decision.pointer ? (
              <PointerLink pointer={decision.pointer} />
            ) : (
              <span className="pointer pointer--none">No place in the code recorded</span>
            )}
          </p>

          {decision.explain_backs.map((explainBack) => (
            <ExplainBackPanel key={explainBack.id} explainBack={explainBack} />
          ))}
        </div>
      </div>
    </li>
  );
}
