import type { Pointer } from "@ftc/shared";

/**
 * The GitHub permalink for a pointer, or null when it cannot be built yet.
 * A pointer needs a repo and a commit to resolve; the pointer service (BE-7)
 * fills those in, and remaps the commit after a squash merge.
 */
export function buildPointerUrl(
  pointer: Pick<Pointer, "repo" | "commit" | "file_path" | "line_hint">,
): string | null {
  if (!pointer.repo || !pointer.commit) return null;
  if (!/^[\w.-]+\/[\w.-]+$/.test(pointer.repo)) return null;
  const path = pointer.file_path
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .map(encodeURIComponent)
    .join("/");
  if (!path) return null;
  const line = pointer.line_hint ? `#L${pointer.line_hint}` : "";
  return `https://github.com/${pointer.repo}/blob/${encodeURIComponent(pointer.commit)}/${path}${line}`;
}

/** "src/bookings.ts, cancelBooking" or "src/bookings.ts, line 88". */
export function pointerLabel(
  pointer: Pick<Pointer, "file_path" | "symbol" | "line_hint">,
): string {
  if (pointer.symbol) return `${pointer.file_path}, ${pointer.symbol}`;
  if (pointer.line_hint) return `${pointer.file_path}, line ${pointer.line_hint}`;
  return pointer.file_path;
}
