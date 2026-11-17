import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Relative asset paths, so the built app works from wherever the local service serves it.
  base: "./",
  // The copy inside the plugin reads real data only, so the sample files stay out of it.
  publicDir: mode === "plugin" ? false : "public",
  server: { port: 4318, strictPort: true },
  preview: { port: 4318, strictPort: true },
}));
