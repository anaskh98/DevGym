import type { Pointer } from "@devgym/shared";

/**
 * linked: opens the code on GitHub. broken: the last check could not find the code (see resolve_note).
 * unlinked: no commit yet, so there is nothing safe to link to.
 */
export type PointerState = "linked" | "broken" | "unlinked";

export function pointerState(pointer: Pick<Pointer, "url" | "resolved">): PointerState {
  if (pointer.resolved === false) return "broken";
  if (!pointer.url || !/^https:\/\/github\.com\//.test(pointer.url)) return "unlinked";
  return "linked";
}

/** "src/bookings.ts, cancelBooking" or "src/bookings.ts, line 88". */
export function pointerLabel(pointer: Pick<Pointer, "file_path" | "symbol" | "line_hint">): string {
  if (pointer.symbol) return `${pointer.file_path}, ${pointer.symbol}`;
  if (pointer.line_hint) return `${pointer.file_path}, line ${pointer.line_hint}`;
  return pointer.file_path;
}
