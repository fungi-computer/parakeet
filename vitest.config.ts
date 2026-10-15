import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.js", "test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/vitest.setup.ts"],
  },
});
