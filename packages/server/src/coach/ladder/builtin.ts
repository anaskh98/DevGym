// The built-in ladders. They are bundled into the plugin's server file, so an installed plugin needs no extra files.
import backend from "./builtin/backend.json" with { type: "json" };
import frontend from "./builtin/frontend.json" with { type: "json" };
import type { Ladder, Track } from "./schema.js";

export const BUILTIN_LADDERS: Record<Track, Ladder> = {
  backend: backend as Ladder,
  frontend: frontend as Ladder,
};
