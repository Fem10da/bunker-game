import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@bunker/content": fileURLToPath(
        new URL("./packages/content/src/index.ts", import.meta.url)
      ),
      "@bunker/contracts": fileURLToPath(
        new URL("./packages/contracts/src/index.ts", import.meta.url)
      ),
      "@bunker/game-engine": fileURLToPath(
        new URL("./packages/game-engine/src/index.ts", import.meta.url)
      )
    }
  },
  test: {
    coverage: {
      exclude: [
        "**/*.d.ts",
        "**/*.integration.test.ts",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.config.*",
        "**/dist/**",
        "apps/backend/src/auth-sessions.ts",
        "apps/backend/src/lobbies.ts",
        "apps/backend/src/playtest-card-runtime.ts",
        "apps/backend/src/server.ts",
        "packages/content/src/cli.ts",
        "packages/contracts/src/**",
        "packages/*/src/index.ts",
        "apps/web/src/main.tsx"
      ],
      include: [
        "apps/backend/src/**/*.ts",
        "apps/edge-worker/src/**/*.ts",
        "apps/web/src/**/*.ts",
        "apps/web/src/**/*.tsx",
        "packages/*/src/**/*.ts"
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    },
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts"
    ],
    passWithNoTests: false
  }
});
