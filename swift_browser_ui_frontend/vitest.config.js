import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Standalone test config — deliberately does NOT reuse vite.config.js, whose
// multi-page/html plugins are build-only and would interfere with unit tests.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    fs: {
      // Specs live at repo-root ../tests/jest, outside the frontend root
      allow: [path.resolve(__dirname, "..")],
    },
  },
  test: {
    environment: "jsdom",
    include: ["../tests/jest/**/*.spec.js"],
  },
});
