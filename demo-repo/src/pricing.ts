import type { Room } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const PEAK_MULTIPLIER = 1.5;

/** Peak time is Monday to Friday, 09:00 to 17:00 UTC. */
export function isPeakHour(hourStart: Date): boolean {
  const day = hourStart.getUTCDay();
  const hour = hourStart.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 17;
}

/** Credits for a booking. Bookings are whole hours, priced hour by hour. */
export function priceBooking(room: Room, start: Date, end: Date): number {
  let credits = 0;
  for (let t = start.getTime(); t < end.getTime(); t += HOUR_MS) {
    credits += room.creditsPerHour * (isPeakHour(new Date(t)) ? PEAK_MULTIPLIER : 1);
  }
  return credits;
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / HOUR_MS;
}
