/**
 * Manual test script to verify the Stagehand agent works correctly.
 * Run with: npm run test:manual
 */

import "dotenv/config";
import { EnvSchema } from "./types/index.js";
import { runTestsForIssue } from "./services/stagehand.js";
import { saveTestResult } from "./services/storage.js";
import type { ParsedIssue } from "./types/index.js";

async function main() {
  // Validate environment
  const envResult = EnvSchema.safeParse(process.env);
  if (!envResult.success) {
    console.error("Invalid environment configuration:");
    console.error(envResult.error.format());
    process.exit(1);
  }

  const env = envResult.data;

  // Create a mock issue for testing
  const mockIssue: ParsedIssue = {
    id: "test-issue-001",
    identifier: "TEST-001",
    title: "Manual Test Run",
    url: undefined,
    acceptanceCriteria: [
      "User can see the login page",
      "User can enter credentials",
      "User can successfully log in",
    ],
    rawDescription: `
## Acceptance Criteria
- [ ] User can see the login page
- [ ] User can enter credentials
- [ ] User can successfully log in
    `,
  };

  console.log("=".repeat(60));
  console.log("Manual Test Run");
  console.log("=".repeat(60));
  console.log(`Portal URL: ${env.PORTAL_URL}`);
  console.log(`Username: ${env.PORTAL_USERNAME}`);
  console.log(`Acceptance Criteria: ${mockIssue.acceptanceCriteria.length}`);
  console.log("=".repeat(60));

  try {
    const result = await runTestsForIssue(mockIssue, {
      portalUrl: env.PORTAL_URL,
      username: env.PORTAL_USERNAME,
      password: env.PORTAL_PASSWORD,
    });

    // Save the result
    const resultPath = await saveTestResult(result);

    console.log("\n" + "=".repeat(60));
    console.log("Test Results");
    console.log("=".repeat(60));
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Duration: ${result.duration}ms`);
    console.log(`Results saved to: ${resultPath}`);
    console.log("\nCriterion Results:");

    for (const r of result.results) {
      const icon = r.passed ? "✓" : "✗";
      console.log(`  ${icon} ${r.criterion}`);
      console.log(`    ${r.details}`);
    }

    if (result.screenshots && result.screenshots.length > 0) {
      console.log("\nScreenshots:");
      for (const s of result.screenshots) {
        console.log(`  - ${s}`);
      }
    }

    if (result.errorMessage) {
      console.log(`\nError: ${result.errorMessage}`);
    }

    console.log("=".repeat(60));
  } catch (error) {
    console.error("Test run failed:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
