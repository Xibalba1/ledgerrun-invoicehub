import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/test/**/*.test.ts", "web/src/**/*.test.{ts,tsx}"],
    environment: "node",
    environmentMatchGlobs: [["web/src/**/*.test.{ts,tsx}", "jsdom"]],
    setupFiles: ["web/src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "server/src/{api,config,db,decide,events,fuzzy,ingest,logger,match,pipeline,resolve,storage}.ts",
        "shared/src/**/*.ts",
        "web/src/{api,lib,useInvoices}.ts",
      ],
      exclude: ["web/src/test/**"],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75,
      },
    },
  },
});
