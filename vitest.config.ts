import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}", "tests/integration/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // Without this, Vitest loads next-auth/@auth/core via Node's
        // native ESM resolver, which enforces strict file-extension
        // resolution. next-auth's internal `import ... from "next/server"`
        // (no extension) relies on bundler-style automatic extension
        // resolution — which Next.js's own build pipeline provides, but
        // Node's native loader does not. Inlining these two packages
        // routes them through Vite's transform pipeline instead, which
        // resolves extensions the same way a real Next.js build does.
        inline: ["next-auth", "@auth/core"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
