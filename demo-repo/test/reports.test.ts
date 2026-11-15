import { describe, expect, it } from "vitest";
import { createBooking } from "../src/bookings";
import { monthlyUsage } from "../src/reports";
import { SAT, setup, WED } from "./helpers";

describe("monthlyUsage", () => {
  it("totals bookings, hours and credits per room", () => {
    const { store, clock } = setup();
    createBooking(store, clock, "m-ada", { roomId: "r-atlas", start: SAT(10), end: SAT(12) });
    createBooking(store, clock, "m-cleo", { roomId: "r-atlas", start: WED(9), end: WED(10) });
    createBooking(store, clock, "m-cleo", { roomId: "r-birch", start: SAT(10), end: SAT(11) });

    expect(monthlyUsage(store, "2026-03")).toEqual([
      { roomId: "r-atlas", room: "Atlas", bookings: 2, hours: 3, credits: 35 },
      { roomId: "r-birch", room: "Birch", bookings: 1, hours: 1, credits: 6 },
    ]);
  });

  it("leaves out other months", () => {
    const { store, clock } = setup();
    createBooking(store, clock, "m-ada", { roomId: "r-atlas", start: SAT(10), end: SAT(12) });
    expect(monthlyUsage(store, "2026-04").every((row) => row.bookings === 0)).toBe(true);
  });
});
