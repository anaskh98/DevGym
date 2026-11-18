import { defineConfig } from "vitest/config";

// Many tests start real git processes and tree-sitter, so on a slow or busy machine the default 5 seconds is too short.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
