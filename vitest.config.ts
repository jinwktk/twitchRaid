import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/utils/logger.ts",
        "src/utils/process-restart.ts",
        "src/bot.ts", // 神クラス、Week5以降に分割後テスト
      ],
      thresholds: {
        // 段階的引き上げ予定 (Week1: 30% → Week4: 80%)
        lines: 30,
        functions: 30,
        branches: 25,
      },
    },
  },
});
