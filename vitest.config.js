import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["fake-indexeddb/auto"], // gives db.js a working indexedDB
    include: ["src/**/*.test.{js,jsx}"],
  },
});
