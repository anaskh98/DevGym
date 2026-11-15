import { createBooking, getBooking, getSchedule, type CreateBookingInput } from "./bookings";
import { HttpError } from "./errors";
import { notify } from "./notifier";
import { monthlyUsage } from "./reports";
import type { Store } from "./store";
import type { Booking, Clock } from "./types";
import { topUp } from "./wallets";

export interface AppRequest {
  method: string;
  /** Path with query string, e.g. "/rooms/r-atlas/schedule?day=2026-03-02". */
  url: string;
  /** From the x-member-id header. */
  actorId: string | null;
  body?: unknown;
}

export interface AppResponse {
  status: number;
  body: unknown;
}

/** The one shape bookings are returned in. */
export function toBookingResponse(store: Store, booking: Booking) {
  return {
    id: booking.id,
    room: store.rooms.get(booking.roomId)?.name ?? booking.roomId,
    roomId: booking.roomId,
    bookedBy: booking.bookedBy,
    attendeeIds: booking.attendeeIds,
    start: booking.start,
    end: booking.end,
    creditsCharged: booking.creditsCharged,
  };
}

function requireActor(request: AppRequest): string {
  if (!request.actorId) throw new HttpError(403, "unknown_member", "x-member-id is required.");
  return request.actorId;
}

function requireAdmin(store: Store, actorId: string): void {
  if (store.members.get(actorId)?.role !== "admin") {
    throw new HttpError(403, "admin_only", "Only admins can do this.");
  }
}

function route(store: Store, clock: Clock, request: AppRequest): AppResponse {
  const url = new URL(request.url, "http://roomly.local");
  const parts = url.pathname.split("/").filter(Boolean);
  const actorId = requireActor(request);

  if (request.method === "POST" && parts.length === 1 && parts[0] === "bookings") {
    const booking = createBooking(store, clock, actorId, request.body as CreateBookingInput);
    return { status: 201, body: toBookingResponse(store, booking) };
  }

  if (request.method === "GET" && parts.length === 2 && parts[0] === "bookings") {
    return { status: 200, body: toBookingResponse(store, getBooking(store, parts[1] as string)) };
  }

  if (
    request.method === "GET" &&
    parts.length === 3 &&
    parts[0] === "rooms" &&
    parts[2] === "schedule"
  ) {
    const day = url.searchParams.get("day") ?? "";
    const bookings = getSchedule(store, parts[1] as string, day);
    return { status: 200, body: bookings.map((b) => toBookingResponse(store, b)) };
  }

  if (request.method === "GET" && parts.length === 2 && parts[0] === "reports" && parts[1] === "usage") {
    requireAdmin(store, actorId);
    return { status: 200, body: monthlyUsage(store, url.searchParams.get("month") ?? "") };
  }

  if (
    request.method === "POST" &&
    parts.length === 3 &&
    parts[0] === "wallets" &&
    parts[2] === "top-up"
  ) {
    requireAdmin(store, actorId);
    const walletId = parts[1] as string;
    const credits = Number((request.body as { credits?: unknown } | undefined)?.credits);
    topUp(store, walletId, credits);
    const wallet = store.wallets.get(walletId);
    if (wallet?.kind === "member") {
      notify(store, clock, wallet.ownerId, "wallet_topped_up", { credits: String(credits) });
    }
    return { status: 200, body: wallet };
  }

  throw new HttpError(404, "not_found", "No such route.");
}

export function handle(store: Store, clock: Clock, request: AppRequest): AppResponse {
  try {
    return route(store, clock, request);
  } catch (error) {
    if (error instanceof HttpError) {
      return { status: error.status, body: { error: error.code, message: error.message } };
    }
    throw error;
  }
}
