import { createStore } from "../src/store";
import type { Clock } from "../src/types";

/** Monday 2 March 2026, 08:00 UTC. */
export const NOW = new Date("2026-03-02T08:00:00.000Z");

export function setup() {
  const store = createStore();
  const clock: Clock = () => NOW;
  return { store, clock };
}

/** Wednesday 4 March 2026: a weekday, so 09:00 to 17:00 is peak. */
export const WED = (hour: number) =>
  `2026-03-04T${String(hour).padStart(2, "0")}:00:00.000Z`;

/** Saturday 7 March 2026: never peak. */
export const SAT = (hour: number) =>
  `2026-03-07T${String(hour).padStart(2, "0")}:00:00.000Z`;
