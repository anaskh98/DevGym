import { HttpError } from "./errors";
import { notify } from "./notifier";
import { priceBooking } from "./pricing";
import type { Store } from "./store";
import type { Booking, Clock, Member, WalletKind } from "./types";
import { charge, walletFor } from "./wallets";

export interface CreateBookingInput {
  roomId: string;
  start: string;
  end: string;
  attendeeIds?: string[];
  payWith?: WalletKind;
}

function requireMember(store: Store, memberId: string): Member {
  const member = store.members.get(memberId);
  if (!member) throw new HttpError(403, "unknown_member", "Unknown member.");
  return member;
}

function parseHour(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "invalid_time", `${field} is not a valid timestamp.`);
  }
  if (date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0) {
    throw new HttpError(400, "invalid_time", `${field} must be on the hour.`);
  }
  return date;
}

function overlaps(booking: Booking, start: Date, end: Date): boolean {
  return new Date(booking.start) < end && start < new Date(booking.end);
}

export function createBooking(
  store: Store,
  clock: Clock,
  actorId: string,
  input: CreateBookingInput,
): Booking {
  const member = requireMember(store, actorId);
  const room = store.rooms.get(input.roomId);
  if (!room) throw new HttpError(404, "room_not_found", "Room not found.");

  const start = parseHour(input.start, "start");
  const end = parseHour(input.end, "end");
  if (end <= start) throw new HttpError(400, "invalid_time", "end must be after start.");
  if (start <= clock()) throw new HttpError(400, "invalid_time", "start must be in the future.");

  const attendeeIds = [...new Set(input.attendeeIds ?? [])].filter((id) => id !== member.id);
  for (const id of attendeeIds) {
    if (!store.members.has(id)) {
      throw new HttpError(400, "unknown_attendee", `Unknown attendee: ${id}.`);
    }
  }
  if (attendeeIds.length + 1 > room.capacity) {
    throw new HttpError(400, "over_capacity", `${room.name} holds ${room.capacity} people.`);
  }

  const taken = [...store.bookings.values()].some(
    (b) => b.roomId === room.id && overlaps(b, start, end),
  );
  if (taken) throw new HttpError(409, "slot_taken", "The room is already booked for that time.");

  const credits = priceBooking(room, start, end);
  const wallet = walletFor(store, member, input.payWith ?? "member");
  charge(store, wallet.id, credits);

  const booking: Booking = {
    id: `b-${store.nextBookingNumber++}`,
    roomId: room.id,
    bookedBy: member.id,
    attendeeIds,
    start: start.toISOString(),
    end: end.toISOString(),
    creditsCharged: credits,
    paidFromWalletId: wallet.id,
    createdAt: clock().toISOString(),
  };
  store.bookings.set(booking.id, booking);

  notify(store, clock, member.id, "booking_confirmed", {
    bookingId: booking.id,
    room: room.name,
    start: booking.start,
  });

  return booking;
}

export function getBooking(store: Store, bookingId: string): Booking {
  const booking = store.bookings.get(bookingId);
  if (!booking) throw new HttpError(404, "booking_not_found", "Booking not found.");
  return booking;
}

/** A room's bookings for one UTC day (YYYY-MM-DD), earliest first. */
export function getSchedule(store: Store, roomId: string, day: string): Booking[] {
  if (!store.rooms.has(roomId)) throw new HttpError(404, "room_not_found", "Room not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new HttpError(400, "invalid_day", "day must be YYYY-MM-DD.");
  }
  return [...store.bookings.values()]
    .filter((b) => b.roomId === roomId && b.start.startsWith(day))
    .sort((a, b) => a.start.localeCompare(b.start));
}
