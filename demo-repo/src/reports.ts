import { HttpError } from "./errors";
import { hoursBetween } from "./pricing";
import type { Store } from "./store";

export interface RoomUsage {
  roomId: string;
  room: string;
  bookings: number;
  hours: number;
  credits: number;
}

/**
 * Bookings, hours and credits per room for one UTC month (YYYY-MM).
 * Finance invoices from this report.
 */
export function monthlyUsage(store: Store, month: string): RoomUsage[] {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new HttpError(400, "invalid_month", "month must be YYYY-MM.");
  }
  const usage = new Map<string, RoomUsage>();
  for (const room of store.rooms.values()) {
    usage.set(room.id, { roomId: room.id, room: room.name, bookings: 0, hours: 0, credits: 0 });
  }
  for (const booking of store.bookings.values()) {
    if (!booking.start.startsWith(month)) continue;
    const row = usage.get(booking.roomId);
    if (!row) continue;
    row.bookings += 1;
    row.hours += hoursBetween(new Date(booking.start), new Date(booking.end));
    row.credits += booking.creditsCharged;
  }
  return [...usage.values()];
}
