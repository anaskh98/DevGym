import type { Pointer } from "@ftc/shared";
import { pointerLabel, pointerState } from "../lib/pointer";

/**
 * Where a decision lives in the code. Links to GitHub at a fixed commit. A pointer the last check could
 * not resolve, or one without a commit yet, says so instead of linking somewhere wrong.
 */
export function PointerLink({ pointer }: { pointer: Pointer }) {
  const label = pointerLabel(pointer);
  const state = pointerState(pointer);
  if (state === "broken") {
    return (
      <span className="pointer pointer--broken">
        <code>{label}</code>
        <span className="pointer__note">broken: {pointer.resolve_note ?? "the code was not found at this commit"}</span>
      </span>
    );
  }
  if (state === "unlinked" || !pointer.url) {
    return (
      <span className="pointer pointer--unlinked" title="This pointer has no commit yet">
        <code>{label}</code>
        <span className="pointer__note">not linked yet</span>
      </span>
    );
  }
  return (
    <a className="pointer" href={pointer.url} target="_blank" rel="noreferrer noopener">
      <code>{label}</code>
      {pointer.resolved === true && <span className="pointer__ok">resolves</span>}
    </a>
  );
}
