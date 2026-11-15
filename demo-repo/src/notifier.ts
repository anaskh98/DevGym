import type { Store } from "./store";
import type { Clock } from "./types";

export type Template = "booking_confirmed" | "wallet_topped_up";

/** Queues a notification for one member. Delivery is out of scope here. */
export function notify(
  store: Store,
  clock: Clock,
  to: string,
  template: Template,
  data: Record<string, string>,
): void {
  store.outbox.push({ to, template, data, sentAt: clock().toISOString() });
}
