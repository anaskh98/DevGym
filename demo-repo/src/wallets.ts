import { HttpError } from "./errors";
import type { Store } from "./store";
import type { Member, Wallet, WalletKind } from "./types";

function findWallet(store: Store, kind: WalletKind, ownerId: string): Wallet | undefined {
  return [...store.wallets.values()].find((w) => w.kind === kind && w.ownerId === ownerId);
}

/** The wallet a member pays from: their own, or their team's. */
export function walletFor(store: Store, member: Member, payWith: WalletKind): Wallet {
  if (payWith === "team") {
    if (!member.teamId) {
      throw new HttpError(400, "no_team", `${member.name} is not in a team.`);
    }
    const teamWallet = findWallet(store, "team", member.teamId);
    if (!teamWallet) throw new HttpError(404, "wallet_not_found", "The team has no wallet.");
    return teamWallet;
  }
  const own = findWallet(store, "member", member.id);
  if (!own) throw new HttpError(404, "wallet_not_found", `${member.name} has no wallet.`);
  return own;
}

export function charge(store: Store, walletId: string, credits: number): void {
  const wallet = store.wallets.get(walletId);
  if (!wallet) throw new HttpError(404, "wallet_not_found", "Wallet not found.");
  if (wallet.balance < credits) {
    throw new HttpError(402, "insufficient_credits", "Not enough credits for this booking.");
  }
  wallet.balance -= credits;
}

export function topUp(store: Store, walletId: string, credits: number): void {
  const wallet = store.wallets.get(walletId);
  if (!wallet) throw new HttpError(404, "wallet_not_found", "Wallet not found.");
  if (credits <= 0) throw new HttpError(400, "invalid_amount", "Top-up must be positive.");
  wallet.balance += credits;
}
