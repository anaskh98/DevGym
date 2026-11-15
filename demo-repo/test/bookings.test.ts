import { describe, expect, it } from "vitest";
import { createBooking, getSchedule } from "../src/bookings";
import { HttpError } from "../src/errors";
import { SAT, setup, WED } from "./helpers";

function expectHttpError(fn: () => unknown, status: number, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(status);
    expect((error as HttpError).code).toBe(code);
    return;
  }
  throw new Error(`expected HttpError ${status} ${code}`);
}

describe("createBooking", () => {
  it("charges the member's own wallet by default", () => {
    const { store, clock } = setup();
    const booking = createBooking(store, clock, "m-ada", {
      roomId: "r-atlas",
      start: SAT(10),
      end: SAT(12),
    });
    expect(booking.creditsCharged).toBe(20);
    expect(booking.paidFromWalletId).toBe("w-ada");
    expect(store.wallets.get("w-ada")?.balance).toBe(80);
  });

  it("charges peak hours at 1.5x", () => {
    const { store, clock } = setup();
    const booking = createBooking(store, clock, "m-ada", {
      roomId: "r-atlas",
      start: WED(16),
      end: WED(18),
    });
    // 16:00 is peak (15), 17:00 is not (10).
    expect(booking.creditsCharged).toBe(25);
  });

  it("can pay from the team wallet", () => {
    const { store, clock } = setup();
    const booking = createBooking(store, clock, "m-ben", {
      roomId: "r-atlas",
      start: SAT(10),
      end: SAT(14),
      payWith: "team",
    });
    expect(booking.paidFromWalletId).toBe("w-platform");
    expect(store.wallets.get("w-platform")?.balance).toBe(460);
    expect(store.wallets.get("w-ben")?.balance).toBe(20);
  });

  it("rejects paying from a team wallet without a team", () => {
    const { store, clock } = setup();
    expectHttpError(
      () =>
        createBooking(store, clock, "m-cleo", {
          roomId: "r-birch",
          start: SAT(10),
          end: SAT(11),
          payWith: "team",
        }),
      400,
      "no_team",
    );
  });

  it("rejects a booking the wallet cannot pay for", () => {
    const { store, clock } = setup();
    expectHttpError(
      () => createBooking(store, clock, "m-ben", { roomId: "r-atlas", start: SAT(10), end: SAT(13) }),
      402,
      "insufficient_credits",
    );
    expect(store.bookings.size).toBe(0);
  });

  it("rejects an overlapping booking", () => {
    const { store, clock } = setup();
    createBooking(store, clock, "m-ada", { roomId: "r-atlas", start: SAT(10), end: SAT(12) });
    expectHttpError(
      () => createBooking(store, clock, "m-cleo", { roomId: "r-atlas", start: SAT(11), end: SAT(13) }),
      409,
      "slot_taken",
    );
  });

  it("allows back-to-back bookings", () => {
    const { store, clock } = setup();
    createBooking(store, clock, "m-ada", { roomId: "r-atlas", start: SAT(10), end: SAT(12) });
    createBooking(store, clock, "m-cleo", { roomId: "r-atlas", start: SAT(12), end: SAT(13) });
    expect(getSchedule(store, "r-atlas", "2026-03-07").map((b) => b.bookedBy)).toEqual([
      "m-ada",
      "m-cleo",
    ]);
  });

  it("rejects a start in the past and times off the hour", () => {
    const { store, clock } = setup();
    expectHttpError(
      () =>
        createBooking(store, clock, "m-ada", {
          roomId: "r-atlas",
          start: "2026-03-01T10:00:00.000Z",
          end: "2026-03-01T11:00:00.000Z",
        }),
      400,
      "invalid_time",
    );
    expectHttpError(
      () =>
        createBooking(store, clock, "m-ada", {
          roomId: "r-atlas",
          start: "2026-03-07T10:30:00.000Z",
          end: SAT(12),
        }),
      400,
      "invalid_time",
    );
  });

  it("checks room capacity, counting the booker", () => {
    const { store, clock } = setup();
    expectHttpError(
      () =>
        createBooking(store, clock, "m-ada", {
          roomId: "r-birch",
          start: SAT(10),
          end: SAT(11),
          attendeeIds: ["m-ben", "m-cleo", "m-dana"],
        }),
      400,
      "over_capacity",
    );
  });

  it("confirms the booking to the member who made it", () => {
    const { store, clock } = setup();
    const booking = createBooking(store, clock, "m-ada", {
      roomId: "r-atlas",
      start: SAT(10),
      end: SAT(11),
      attendeeIds: ["m-ben"],
    });
    expect(store.outbox).toEqual([
      {
        to: "m-ada",
        template: "booking_confirmed",
        data: { bookingId: booking.id, room: "Atlas", start: SAT(10) },
        sentAt: "2026-03-02T08:00:00.000Z",
      },
    ]);
  });
});
