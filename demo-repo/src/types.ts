export type Role = "member" | "admin";

export interface Member {
  id: string;
  name: string;
  role: Role;
  /** The team whose wallet this member may pay from, if any. */
  teamId: string | null;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  creditsPerHour: number;
}

export type WalletKind = "member" | "team";

export interface Wallet {
  id: string;
  kind: WalletKind;
  /** A member id or a team id, depending on kind. */
  ownerId: string;
  balance: number;
}

export interface Booking {
  id: string;
  roomId: string;
  /** The member who made the booking. */
  bookedBy: string;
  /** Other members invited to the meeting. */
  attendeeIds: string[];
  /** ISO-8601, UTC. */
  start: string;
  /** ISO-8601, UTC. */
  end: string;
  creditsCharged: number;
  /** The wallet that paid: the member's own or their team's. */
  paidFromWalletId: string;
  createdAt: string;
}

export interface Notification {
  to: string;
  template: string;
  data: Record<string, string>;
  sentAt: string;
}

/** Injected so tests control time. Always UTC. */
export type Clock = () => Date;
