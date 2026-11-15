import type { Pointer } from "@ftc/shared";
import { buildPointerUrl, pointerLabel } from "../lib/pointer";

/**
 * A link to the file and function a decision lives in, on GitHub.
 * When the pointer cannot be resolved yet, it says so instead of linking
 * somewhere wrong. Used by Paper Trail (FE-3).
 */
export function PointerLink({ pointer }: { pointer: Pointer }) {
  const url = buildPointerUrl(pointer);
  const label = pointerLabel(pointer);

  if (!url) {
    return (
      <span className="pointer pointer--broken" title="This pointer has no repository or commit yet">
        <code>{label}</code>
        <span className="pointer__note">not linked yet</span>
      </span>
    );
  }
  return (
    <a className="pointer" href={url} target="_blank" rel="noreferrer noopener">
      <code>{label}</code>
    </a>
  );
}
