import { defineConfig } from "vitest/config";

// Browserbase concurrent session limit (adjust based on your plan)
const BROWSERBASE_MAX_CONCURRENT = 25;

export default defineConfig({
  test: {
    // Increase timeout for browser automation tests
    testTimeout: 90000, // 90 seconds per test (reduced since auth is cached)
    hookTimeout: 90000,

    // Run all test files in parallel - each gets its own browser instance
    fileParallelism: true,
    
    // Limit concurrency to avoid hitting Browserbase session limits
    // Each test file creates its own Stagehand/browser session
    maxConcurrency: BROWSERBASE_MAX_CONCURRENT,

    // Include test files
    include: ["tests/**/*.test.ts"],

    // Global setup - logs in once and caches cookies
    globalSetup: ["tests/stagehand/global-setup.ts"],

    // Verbose reporter - shows test names as they run with timing
    reporters: ["verbose"],

    // Highlight tests that take longer than 10 seconds
    slowTestThreshold: 10000,

    // Show failures immediately as they happen (not just at end)
    printConsoleTrace: true,

    // Retry failed tests once (helpful for flaky browser tests)
    retry: 1,

    // Environment setup
    env: {
      NODE_ENV: "test",
    },
  },
});
