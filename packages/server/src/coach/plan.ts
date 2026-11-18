// Focus frames: the fixed part of each growth plan item, built by code.
import type { ItemState } from "./state.js";

export interface FocusFrame {
  ladder_id: string;
  item_id: string;
  title: string;
  state: ItemState;
  needs: string[];
  stack: string | null;
  stack_note: { note: string; link: string; source: "ladder" | "local" } | null;
  study: string[];
  spot: { file: string; symbol: string | null } | null;
  evidence_ids: string[];
}
