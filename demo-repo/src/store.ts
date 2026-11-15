import type { Booking, Member, Notification, Room, Wallet } from "./types";

/** In-memory data. Reset on restart. */
export interface Store {
  members: Map<string, Member>;
  rooms: Map<string, Room>;
  wallets: Map<string, Wallet>;
  bookings: Map<string, Booking>;
  outbox: Notification[];
  nextBookingNumber: number;
}

export function createStore(): Store {
  const members: Member[] = [
    { id: "m-ada", name: "Ada", role: "member", teamId: "t-platform" },
    { id: "m-ben", name: "Ben", role: "member", teamId: "t-platform" },
    { id: "m-cleo", name: "Cleo", role: "member", teamId: null },
    { id: "m-dana", name: "Dana", role: "admin", teamId: null },
  ];
  const rooms: Room[] = [
    { id: "r-atlas", name: "Atlas", capacity: 8, creditsPerHour: 10 },
    { id: "r-birch", name: "Birch", capacity: 3, creditsPerHour: 6 },
  ];
  const wallets: Wallet[] = [
    { id: "w-ada", kind: "member", ownerId: "m-ada", balance: 100 },
    { id: "w-ben", kind: "member", ownerId: "m-ben", balance: 20 },
    { id: "w-cleo", kind: "member", ownerId: "m-cleo", balance: 60 },
    { id: "w-dana", kind: "member", ownerId: "m-dana", balance: 100 },
    { id: "w-platform", kind: "team", ownerId: "t-platform", balance: 500 },
  ];

  return {
    members: new Map(members.map((m) => [m.id, m])),
    rooms: new Map(rooms.map((r) => [r.id, r])),
    wallets: new Map(wallets.map((w) => [w.id, w])),
    bookings: new Map(),
    outbox: [],
    nextBookingNumber: 1,
  };
}
