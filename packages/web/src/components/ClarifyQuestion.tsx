import type { Assumption } from "@devgym/shared";
import { StatusTag } from "./StatusTag";

/**
 * One fork: the question, and how it was settled. A solid line means the PO answered;
 * a dashed one means the developer assumed it, and it still needs confirming.
 */
export function ClarifyQuestion({ assumption, number }: { assumption: Assumption; number: number }) {
  const answered = assumption.status === "answered_by_po";
  return (
    <li className={`fork fork--${assumption.status}`}>
      <h3 className="fork__question">
        <span className="fork__number" aria-hidden="true">
          {number}
        </span>
        {assumption.text}
      </h3>
      <ul className="fork__paths">
        <li className="fork__outcome">
          <StatusTag status={assumption.status} />
          <p>
            <span className="visually-hidden">{answered ? "The PO answered" : "The developer assumed"}: </span>
            {assumption.answer ?? <span className="fork__none">No assumption written down.</span>}
          </p>
        </li>
      </ul>
    </li>
  );
}
