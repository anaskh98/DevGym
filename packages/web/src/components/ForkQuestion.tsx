import type { Assumption } from "@ftc/shared";
import { takenReadingIndex } from "../lib/fork";
import { StatusTag } from "./StatusTag";

/**
 * One fork, drawn as what it is: a question that splits into readings, and
 * the path that was taken. A solid line means the PO chose it; a dashed
 * outline on the tag means the developer assumed it.
 */
export function ForkQuestion({ assumption, number }: { assumption: Assumption; number: number }) {
  const taken = takenReadingIndex(assumption);
  const outcomeLabel =
    assumption.status === "answered_by_po" ? "The PO answered" : "The developer assumed";

  return (
    <li className={`fork fork--${assumption.status}`}>
      <h3 className="fork__question">
        <span className="fork__number" aria-hidden="true">
          {number}
        </span>
        {assumption.text}
      </h3>
      <ul className="fork__paths" aria-label="Readings considered">
        {assumption.readings.map((reading, index) => (
          <li
            key={index}
            className={index === taken ? "fork__path fork__path--taken" : "fork__path"}
          >
            {reading}
          </li>
        ))}
        <li className="fork__outcome">
          <StatusTag status={assumption.status} />
          <p>
            <span className="visually-hidden">{outcomeLabel}: </span>
            {assumption.answer}
          </p>
        </li>
      </ul>
    </li>
  );
}
