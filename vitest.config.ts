import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "services/river-slate/test/healthCard.test.ts",
      "services/river-slate/test/server.test.ts",
      "services/river-slate/test/stateReaders.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/cli.ts"],
    },
  },
});
