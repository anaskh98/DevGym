import { describe, expect, it } from "vitest";
import { handle } from "../src/app";
import { SAT, setup } from "./helpers";

describe("HTTP routes", () => {
  it("creates a booking and returns it in the booking shape", () => {
    const { store, clock } = setup();
    const response = handle(store, clock, {
      method: "POST",
      url: "/bookings",
      actorId: "m-ada",
      body: { roomId: "r-atlas", start: SAT(10), end: SAT(11) },
    });
    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: "b-1",
      room: "Atlas",
      roomId: "r-atlas",
      bookedBy: "m-ada",
      attendeeIds: [],
      start: SAT(10),
      end: SAT(11),
      creditsCharged: 10,
    });
  });

  it("lists a room's schedule for a day", () => {
    const { store, clock } = setup();
    handle(store, clock, {
      method: "POST",
      url: "/bookings",
      actorId: "m-ada",
      body: { roomId: "r-atlas", start: SAT(10), end: SAT(11) },
    });
    const response = handle(store, clock, {
      method: "GET",
      url: "/rooms/r-atlas/schedule?day=2026-03-07",
      actorId: "m-cleo",
    });
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
  });

  it("requires x-member-id", () => {
    const { store, clock } = setup();
    const response = handle(store, clock, { method: "GET", url: "/bookings/b-1", actorId: null });
    expect(response.status).toBe(403);
  });

  it("maps HttpError to a JSON error body", () => {
    const { store, clock } = setup();
    const response = handle(store, clock, { method: "GET", url: "/bookings/b-9", actorId: "m-ada" });
    expect(response).toEqual({
      status: 404,
      body: { error: "booking_not_found", message: "Booking not found." },
    });
  });

  it("lets only admins read the usage report and top up wallets", () => {
    const { store, clock } = setup();
    expect(
      handle(store, clock, { method: "GET", url: "/reports/usage?month=2026-03", actorId: "m-ada" })
        .status,
    ).toBe(403);
    expect(
      handle(store, clock, { method: "GET", url: "/reports/usage?month=2026-03", actorId: "m-dana" })
        .status,
    ).toBe(200);

    const topUp = handle(store, clock, {
      method: "POST",
      url: "/wallets/w-ben/top-up",
      actorId: "m-dana",
      body: { credits: 30 },
    });
    expect(topUp.status).toBe(200);
    expect(store.wallets.get("w-ben")?.balance).toBe(50);
    expect(store.outbox.at(-1)?.template).toBe("wallet_topped_up");
  });
});
