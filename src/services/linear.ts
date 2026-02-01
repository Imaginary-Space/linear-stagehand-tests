import * as crypto from "crypto";
import { LinearClient } from "@linear/sdk";
import type { LinearWebhookPayload, ParsedIssue } from "../types/index.js";
import { LinearWebhookPayloadSchema } from "../types/index.js";
import type { E2ETestResult, IndividualTestResult } from "./e2e-runner.js";

// =============================================================================
// Linear API Client
// =============================================================================

let linearClient: LinearClient | null = null;

/**
 * Gets or creates the Linear API client
 */
export function getLinearClient(): LinearClient {
  if (!linearClient) {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      throw new Error("LINEAR_API_KEY environment variable is not set");
    }
    linearClient = new LinearClient({ apiKey });
  }
  return linearClient;
}

/**
 * Adds a comment to a Linear issue
 * @param issueIdentifier - The issue identifier (e.g., "FEL-395") or issue ID
 * @param body - The comment body (supports markdown)
 */
export async function addCommentToIssue(
  issueIdentifier: string,
  body: string
): Promise<void> {
  try {
    const client = getLinearClient();
    
    // Find the issue by identifier
    const issue = await client.issue(issueIdentifier);
    
    if (!issue) {
      console.error(`[Linear] Issue not found: ${issueIdentifier}`);
      return;
    }

    // Create the comment
    await client.createComment({
      issueId: issue.id,
      body,
    });

    console.log(`[Linear] Comment added to ${issueIdentifier}`);
  } catch (error) {
    console.error(`[Linear] Failed to add comment to ${issueIdentifier}:`, error);
    throw error;
  }
}

/**
 * Formats duration in human readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/**
 * Generates an AI recommendation based on test results
 */
export function generateTestRecommendation(result: E2ETestResult): string {
  const recommendations: string[] = [];

  // Analyze error patterns
  const errors = result.errors || [];
  const failedTests = result.failedTestNames || [];

  // Check for common error patterns
  const hasTimeoutErrors = errors.some(e => 
    e.toLowerCase().includes("timeout") || e.toLowerCase().includes("exceeded")
  );
  const hasBrowserErrors = errors.some(e => 
    e.toLowerCase().includes("browser") || e.toLowerCase().includes("launch")
  );
  const hasNetworkErrors = errors.some(e => 
    e.toLowerCase().includes("network") || e.toLowerCase().includes("fetch")
  );
  const hasAuthErrors = errors.some(e => 
    e.toLowerCase().includes("auth") || e.toLowerCase().includes("login") || e.toLowerCase().includes("401")
  );
  const hasElementErrors = errors.some(e => 
    e.toLowerCase().includes("element") || e.toLowerCase().includes("selector") || e.toLowerCase().includes("not found")
  );

  if (hasTimeoutErrors) {
    recommendations.push("Consider increasing test timeouts or optimizing page load performance");
  }
  if (hasBrowserErrors) {
    recommendations.push("Check browser/Chromium installation and dependencies");
  }
  if (hasNetworkErrors) {
    recommendations.push("Verify network connectivity and API endpoint availability");
  }
  if (hasAuthErrors) {
    recommendations.push("Verify authentication credentials and session handling");
  }
  if (hasElementErrors) {
    recommendations.push("UI selectors may have changed - review page structure");
  }

  // Analyze failed test patterns
  if (failedTests.some(t => t.toLowerCase().includes("navigation"))) {
    recommendations.push("Navigation flow may have changed - verify routing");
  }
  if (failedTests.some(t => t.toLowerCase().includes("form") || t.toLowerCase().includes("input"))) {
    recommendations.push("Form validation or input handling may need attention");
  }

  // If all tests passed
  if (result.status === "passed") {
    return "All tests passed successfully. No action required.";
  }

  // If we have specific recommendations
  if (recommendations.length > 0) {
    return recommendations.join(". ") + ".";
  }

  // Generic recommendation
  if (result.failedTests > 0) {
    return `${result.failedTests} test(s) failed. Review the failed tests and error logs for specific issues.`;
  }

  return "Test run completed with errors. Check the output logs for details.";
}

/**
 * Formats a duration in ms to a readable string
 */
function formatTestDuration(ms: number | undefined): string {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Cleans up a test name for display
 */
function cleanTestName(name: string): string {
  // Remove "should" prefix and clean up
  return name
    .replace(/^should\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formats E2E test results as a markdown comment for Linear
 */
export function formatTestResultsComment(result: E2ETestResult): string {
  const statusEmoji = result.status === "passed" ? "✅" : result.status === "failed" ? "❌" : "⚠️";
  const statusText = result.status === "passed" ? "Passed" : result.status === "failed" ? "Failed" : "Error";

  let comment = `## ${statusEmoji} Test Results\n\n`;
  
  // Summary table
  comment += `| Metric | Value |\n`;
  comment += `|--------|-------|\n`;
  comment += `| Status | **${statusText}** |\n`;
  comment += `| Duration | ${formatDuration(result.duration)} |\n`;
  comment += `| Passed | ${result.passedTests} |\n`;
  comment += `| Failed | ${result.failedTests} |\n`;
  comment += `| Skipped | ${result.skippedTests} |\n`;
  comment += `| Total | ${result.totalTests} |\n\n`;

  // Group tests by suite
  if (result.tests && result.tests.length > 0) {
    const suiteMap = new Map<string, IndividualTestResult[]>();
    
    for (const test of result.tests) {
      const suite = test.suite || "Other";
      if (!suiteMap.has(suite)) {
        suiteMap.set(suite, []);
      }
      suiteMap.get(suite)!.push(test);
    }

    // Test Suites Table
    comment += `### Test Suites\n\n`;
    comment += `| Status | Suite | Passed | Failed | Time |\n`;
    comment += `|:------:|-------|:------:|:------:|------|\n`;
    
    // Sort suites: ones with failures first
    const sortedSuites = [...suiteMap.entries()].sort((a, b) => {
      const aFailed = a[1].some(t => t.status === "failed");
      const bFailed = b[1].some(t => t.status === "failed");
      if (aFailed && !bFailed) return -1;
      if (!aFailed && bFailed) return 1;
      return a[0].localeCompare(b[0]);
    });

    for (const [suite, tests] of sortedSuites) {
      const passed = tests.filter(t => t.status === "passed").length;
      const failed = tests.filter(t => t.status === "failed").length;
      
      // Calculate total duration for the suite
      const totalDuration = tests.reduce((sum, t) => sum + (t.duration || 0), 0);
      
      const suiteIcon = failed > 0 ? "❌" : "✅";
      const suiteName = suite.replace(/([A-Z])/g, " $1").trim();
      
      comment += `| ${suiteIcon} | ${suiteName} | ${passed} | ${failed} | ${formatTestDuration(totalDuration)} |\n`;
    }
    
    // Show failed test details if any
    const failedTests = result.tests.filter(t => t.status === "failed");
    if (failedTests.length > 0) {
      comment += `\n### Failed Tests\n\n`;
      for (const test of failedTests.slice(0, 10)) {
        const duration = test.duration ? ` (${formatTestDuration(test.duration)})` : "";
        comment += `- ❌ **${test.suite}**: ${cleanTestName(test.name)}${duration}\n`;
      }
      if (failedTests.length > 10) {
        comment += `\n_...and ${failedTests.length - 10} more failed tests_\n`;
      }
    }
  }

  // Add error details section if any failures
  if (result.errors && result.errors.length > 0) {
    comment += `\n### Error Details\n`;
    comment += "```\n";
    result.errors.slice(0, 3).forEach(error => {
      const truncated = error.length > 80 ? error.slice(0, 77) + "..." : error;
      comment += `${truncated}\n`;
    });
    comment += "```\n";
  }

  // Add AI recommendation
  const recommendation = generateTestRecommendation(result);
  comment += `\n### Recommendation\n`;
  comment += recommendation;

  return comment;
}

/**
 * Verifies the Linear webhook signature
 * @see https://developers.linear.app/docs/graphql/webhooks#signature-verification
 */
export function verifyWebhookSignature(
  body: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) {
    console.warn("[Linear] No signature provided in webhook request");
    return false;
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  const expectedSignature = hmac.digest("hex");

  if (signature.length !== expectedSignature.length) {
    console.warn("[Linear] Webhook signature verification failed");
    return false;
  }

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!isValid) {
    console.warn("[Linear] Webhook signature verification failed");
  }

  return isValid;
}

/**
 * Parses and validates the Linear webhook payload
 */
export function parseWebhookPayload(body: unknown): LinearWebhookPayload | null {
  try {
    const result = LinearWebhookPayloadSchema.safeParse(body);
    if (!result.success) {
      console.error("[Linear] Invalid webhook payload:", result.error.format());
      return null;
    }
    return result.data;
  } catch (error) {
    console.error("[Linear] Failed to parse webhook payload:", error);
    return null;
  }
}

/**
 * Extracts acceptance criteria from the issue description.
 * Supports multiple formats:
 * - Markdown checkboxes: "- [ ] AC item" or "- [x] AC item"
 * - Numbered lists: "1. AC item" or "1) AC item"
 * - Bullet points: "- AC item" or "* AC item"
 * - Section headers: "## Acceptance Criteria" followed by items
 */
export function extractAcceptanceCriteria(description: string | null | undefined): string[] {
  if (!description) {
    return [];
  }

  const criteria: string[] = [];

  // Try to find an "Acceptance Criteria" section first
  const acSectionRegex = /(?:^|\n)#{1,3}\s*acceptance\s*criteria\s*\n([\s\S]*?)(?=\n#{1,3}\s|\n\n\n|$)/i;
  const acSectionMatch = description.match(acSectionRegex);

  const textToSearch = acSectionMatch ? acSectionMatch[1] : description;

  // Match checkbox items: "- [ ] item" or "- [x] item"
  const checkboxRegex = /^[\s]*[-*]\s*\[[ x]\]\s*(.+)$/gim;
  let match;
  while ((match = checkboxRegex.exec(textToSearch)) !== null) {
    const criterion = match[1].trim();
    if (criterion && !criteria.includes(criterion)) {
      criteria.push(criterion);
    }
  }

  // If no checkboxes found, try numbered lists
  if (criteria.length === 0) {
    const numberedRegex = /^[\s]*\d+[.)]\s*(.+)$/gim;
    while ((match = numberedRegex.exec(textToSearch)) !== null) {
      const criterion = match[1].trim();
      if (criterion && !criteria.includes(criterion)) {
        criteria.push(criterion);
      }
    }
  }

  // If still nothing, try bullet points (but only in AC section)
  if (criteria.length === 0 && acSectionMatch) {
    const bulletRegex = /^[\s]*[-*]\s+(.+)$/gim;
    while ((match = bulletRegex.exec(textToSearch)) !== null) {
      const criterion = match[1].trim();
      if (criterion && !criteria.includes(criterion)) {
        criteria.push(criterion);
      }
    }
  }

  return criteria;
}

/**
 * Parses a Linear issue into a structured format for testing
 */
export function parseIssueForTesting(payload: LinearWebhookPayload): ParsedIssue {
  const { data } = payload;

  return {
    id: data.id,
    identifier: data.identifier,
    title: data.title,
    url: data.url,
    acceptanceCriteria: extractAcceptanceCriteria(data.description),
    rawDescription: data.description ?? null,
  };
}

/**
 * Checks if an issue should trigger acceptance criteria tests based on its state
 * You can customize this to match your workflow
 */
export function shouldTriggerTests(payload: LinearWebhookPayload): boolean {
  // Only process Issue updates
  if (payload.type !== "Issue") {
    return false;
  }

  // Only process update actions (state changes)
  if (payload.action !== "update") {
    return false;
  }

  // Check if the issue is in a "Ready for Testing" state
  // Customize this to match your Linear workflow states
  const testingStates = [
    "ready for testing",
    "ready to test",
    "in testing",
    "testing",
  ];

  const currentState = payload.data.state?.name?.toLowerCase();
  if (currentState && testingStates.includes(currentState)) {
    return true;
  }

  // Also check for a "test" label
  const hasTestLabel = payload.data.labels?.some(
    (label) => label.name.toLowerCase().includes("test")
  );

  return hasTestLabel ?? false;
}

/**
 * Checks if an issue should trigger E2E tests (full test suite)
 * Triggered when an issue moves to "QA" status
 */
export function shouldTriggerE2ETests(payload: LinearWebhookPayload): boolean {
  // Only process Issue updates
  if (payload.type !== "Issue") {
    return false;
  }

  // Only process update actions (state changes)
  if (payload.action !== "update") {
    return false;
  }

  // Check if the issue is in the "QA" state
  const qaStates = ["qa", "quality assurance", "e2e testing", "e2e"];

  const currentState = payload.data.state?.name?.toLowerCase();
  if (currentState && qaStates.includes(currentState)) {
    console.log(`[Linear] Issue moved to QA state: "${payload.data.state?.name}"`);
    return true;
  }

  // Also check for an "e2e" label
  const hasE2ELabel = payload.data.labels?.some(
    (label) => label.name.toLowerCase().includes("e2e")
  );

  if (hasE2ELabel) {
    console.log(`[Linear] Issue has E2E label - triggering E2E tests`);
    return true;
  }

  return false;
}
