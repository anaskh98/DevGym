import { ASSUMPTION_STATUS_LABEL, type AssumptionStatus } from "@ftc/shared";

/** "answered by PO" or "assumed by dev". */
export function StatusTag({ status }: { status: AssumptionStatus }) {
  return <span className={`tag tag--${status}`}>{ASSUMPTION_STATUS_LABEL[status]}</span>;
}
