import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Mirrors the "@/*" path alias in tsconfig.json, so tests import like the app does.
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./src/", import.meta.url)) }],
  },
});
