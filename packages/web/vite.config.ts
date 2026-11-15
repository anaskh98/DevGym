import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Relative asset paths, so the built app works from any path the local
  // server (BE-13) serves it from.
  base: "./",
  server: { port: 4318, strictPort: true },
  preview: { port: 4318, strictPort: true },
});
