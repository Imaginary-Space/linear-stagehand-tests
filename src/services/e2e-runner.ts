import { spawn } from "child_process";
import { EventEmitter } from "events";
import chalk from "chalk";
import { addCommentToIssue, formatTestResultsComment } from "./linear.js";

export interface IndividualTestResult {
  name: string;
  suite: string;
  status: "passed" | "failed" | "skipped";
  duration?: number; // in ms
}

export interface E2ETestResult {
  issueId: string;
  issueIdentifier?: string;
  status: "passed" | "failed" | "error";
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  duration: number;
  output: string;
  timestamp: string;
  errorMessage?: string;
  failedTestNames?: string[];
  errors?: string[];
  tests?: IndividualTestResult[]; // Individual test results
}

export interface E2ERunOptions {
  issueId: string;
  issueIdentifier?: string;
  testFilter?: string;
}

// Event emitter for streaming test progress
export const e2eEvents = new EventEmitter();

// Track running E2E test runs
const runningE2ETests = new Map<
  string,
  {
    status: "running" | "completed";
    result?: E2ETestResult;
    output: string[];
    startedAt: number;
  }
>();

/**
 * Extract suite name from a test path like "tests/stagehand/e2e/auth.test.ts > Authentication > test name"
 */
function extractSuiteFromPath(path: string): { suite: string; testName: string } {
  // Match patterns like: "tests/.../file.test.ts > SuiteName > test name" or just "> SuiteName > test name"
  const parts = path.split(" > ");
  
  if (parts.length >= 2) {
    // Get the suite name (second part after file path)
    // And the actual test name (last part)
    const filePart = parts[0];
    const suiteName = parts[1];
    const testName = parts.length > 2 ? parts.slice(2).join(" > ") : suiteName;
    
    // Clean up file part to get a readable name if no suite
    const fileName = filePart.split("/").pop()?.replace(".test.ts", "") || "";
    
    return {
      suite: suiteName || fileName.charAt(0).toUpperCase() + fileName.slice(1),
      testName: testName,
    };
  }
  
  return { suite: "Other", testName: path };
}

/**
 * Parse test results from vitest output
 */
function parseTestResults(output: string): {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  failedTestNames: string[];
  tests: IndividualTestResult[];
} {
  const tests: IndividualTestResult[] = [];
  const failedTestNames: string[] = [];
  
  // Strip ANSI color codes for parsing
  const cleanOutput = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = cleanOutput.split("\n");
  
  for (const line of lines) {
    // Match passed tests: "✓ tests/path/file.test.ts > Suite > test name 1234ms"
    const passedMatch = line.match(/[✓√]\s+(.+?)(?:\s+(\d+)ms)?$/);
    if (passedMatch) {
      const fullPath = passedMatch[1].trim();
      const duration = passedMatch[2] ? parseInt(passedMatch[2], 10) : undefined;
      const { suite, testName } = extractSuiteFromPath(fullPath);
      tests.push({
        name: testName,
        suite,
        status: "passed",
        duration,
      });
    }
    
    // Match failed tests: "× tests/path/file.test.ts > Suite > test name 1234ms"
    const failedMatch = line.match(/[×✗]\s+(.+?)(?:\s+(\d+)ms)?$/);
    if (failedMatch) {
      const fullPath = failedMatch[1].trim();
      const duration = failedMatch[2] ? parseInt(failedMatch[2], 10) : undefined;
      const { suite, testName } = extractSuiteFromPath(fullPath);
      tests.push({
        name: testName,
        suite,
        status: "failed",
        duration,
      });
      failedTestNames.push(testName);
    }
    
    // Match skipped tests: "↓ tests/path/file.test.ts > Suite > test name"
    const skippedMatch = line.match(/[↓○]\s+(.+?)$/);
    if (skippedMatch) {
      const fullPath = skippedMatch[1].trim();
      const { suite, testName } = extractSuiteFromPath(fullPath);
      tests.push({
        name: testName,
        suite,
        status: "skipped",
      });
    }
  }
  
  // Calculate totals from parsed tests or fall back to summary line
  let passedTests = tests.filter(t => t.status === "passed").length;
  let failedTests = tests.filter(t => t.status === "failed").length;
  let skippedTests = tests.filter(t => t.status === "skipped").length;
  let totalTests = tests.length;
  
  // If we didn't parse any tests, try summary line
  if (totalTests === 0) {
    const summaryMatch = cleanOutput.match(/Tests\s+(?:(\d+)\s+failed\s+\|\s+)?(\d+)\s+passed\s+\((\d+)\)/i);
    if (summaryMatch) {
      failedTests = summaryMatch[1] ? parseInt(summaryMatch[1], 10) : 0;
      passedTests = parseInt(summaryMatch[2], 10);
      totalTests = parseInt(summaryMatch[3], 10);
    }
    
    const skippedSummary = cleanOutput.match(/(\d+)\s+skipped/i);
    if (skippedSummary) {
      skippedTests = parseInt(skippedSummary[1], 10);
    }
  }

  return { totalTests, passedTests, failedTests, skippedTests, failedTestNames, tests };
}

/**
 * Extract meaningful errors from output
 */
function extractErrors(output: string): string[] {
  const errors: string[] = [];
  const lines = output.split("\n");

  let inErrorBlock = false;
  let currentError: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect error blocks (AssertionError, Error, etc.)
    if (line.includes("AssertionError") || line.includes("Error:") || line.includes("FAIL")) {
      inErrorBlock = true;
      currentError = [line.trim()];
      continue;
    }

    // Collect error context
    if (inErrorBlock) {
      if (line.trim() === "" || line.includes("───") || line.includes("✓") || line.includes("×")) {
        if (currentError.length > 0) {
          errors.push(currentError.join(" ").substring(0, 200));
          currentError = [];
        }
        inErrorBlock = false;
      } else if (currentError.length < 5) {
        currentError.push(line.trim());
      }
    }

    // Specific error patterns
    if (line.includes("Cannot find module") || line.includes("SyntaxError")) {
      errors.push(line.trim());
    }
    if (line.includes("Timeout") && line.includes("exceeded")) {
      errors.push(line.trim());
    }
    if (line.includes("Expected") && line.includes("Received")) {
      errors.push(line.trim());
    }
  }

  // Deduplicate and limit
  return [...new Set(errors)].slice(0, 15);
}

/**
 * Runs the vitest E2E test suite and returns the result
 * Outputs vitest's native UI directly to the console
 */
export async function runE2ETests(options: E2ERunOptions): Promise<E2ETestResult> {
  const { issueId, issueIdentifier, testFilter } = options;
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // Determine the Linear issue to comment on (from options or env variable)
  const linearIssueId = issueIdentifier || process.env.LINEAR_TEST_ID;

  // Post "Initiating Tests" comment to Linear
  if (linearIssueId) {
    try {
      await addCommentToIssue(linearIssueId, "🧪 **Initiating Tests...**");
      console.log(chalk.dim(`[Linear] Posted initiating comment to ${linearIssueId}`));
    } catch (error) {
      console.warn(chalk.yellow(`[Linear] Failed to post initiating comment: ${error}`));
    }
  }

  // Simple header
  console.log("");
  console.log(chalk.cyan.bold(`━━━ E2E Test Suite ${issueIdentifier ? `(${issueIdentifier})` : ""} ━━━`));
  console.log("");

  // Track this run
  runningE2ETests.set(issueId, {
    status: "running",
    output: [],
    startedAt: startTime,
  });

  return new Promise((resolve) => {
    const outputLines: string[] = [];

    // Build vitest command - use default reporter for native UI
    const args = ["run", "tests/stagehand"];
    if (testFilter) {
      args.push("--testNamePattern", testFilter);
    }

    // Spawn vitest with colors enabled and output piped through
    const child = spawn("npx", ["vitest", ...args], {
      cwd: process.cwd(),
      env: { 
        ...process.env, 
        FORCE_COLOR: "1",  // Enable colors
        DOTENV_CONFIG_PATH: `${process.cwd()}/.env` 
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Stream stdout directly to console and capture
    child.stdout.on("data", (data) => {
      const text = data.toString();
      process.stdout.write(text);  // Pass through to console
      outputLines.push(text);
      
      const run = runningE2ETests.get(issueId);
      if (run) run.output.push(text);
    });

    // Stream stderr directly to console and capture
    child.stderr.on("data", (data) => {
      const text = data.toString();
      process.stderr.write(text);  // Pass through to console
      outputLines.push(text);
      
      const run = runningE2ETests.get(issueId);
      if (run) run.output.push(text);
    });

    child.on("close", (code) => {
      const duration = Date.now() - startTime;
      const output = outputLines.join("");
      const parsed = parseTestResults(output);
      const errors = extractErrors(output);

      const status: E2ETestResult["status"] =
        code === 0 ? "passed" : parsed.failedTests > 0 ? "failed" : "error";

      // Summary footer
      console.log("");
      console.log(chalk.cyan.bold(`━━━ Test Run Complete ━━━`));
      console.log(chalk.dim(`Duration: ${Math.round(duration / 1000)}s | Issue: ${linearIssueId || "N/A"}`));
      console.log("");

      const result: E2ETestResult = {
        issueId,
        issueIdentifier,
        status,
        totalTests: parsed.totalTests,
        passedTests: parsed.passedTests,
        failedTests: parsed.failedTests,
        skippedTests: parsed.skippedTests,
        duration,
        output,
        timestamp,
        errorMessage: code !== 0 && parsed.failedTests === 0 ? `Process exited with code ${code}` : undefined,
        failedTestNames: parsed.failedTestNames,
        errors,
        tests: parsed.tests,
      };

      // Post test results comment to Linear
      if (linearIssueId) {
        const resultsComment = formatTestResultsComment(result);
        addCommentToIssue(linearIssueId, resultsComment)
          .then(() => console.log(chalk.dim(`[Linear] Posted results comment to ${linearIssueId}`)))
          .catch((err) => console.warn(chalk.yellow(`[Linear] Failed to post results comment: ${err}`)));
      }

      const run = runningE2ETests.get(issueId);
      if (run) {
        run.status = "completed";
        run.result = result;
      }

      e2eEvents.emit("complete", { issueId, result });
      resolve(result);
    });

    child.on("error", (error) => {
      const duration = Date.now() - startTime;

      console.error(chalk.red(`\nProcess Error: ${error.message}`));

      const result: E2ETestResult = {
        issueId,
        issueIdentifier,
        status: "error",
        totalTests: 0,
        passedTests: 0,
        failedTests: 0,
        skippedTests: 0,
        duration,
        output: outputLines.join(""),
        timestamp,
        errorMessage: error.message,
        errors: [error.message],
      };

      // Post error results comment to Linear
      if (linearIssueId) {
        const resultsComment = formatTestResultsComment(result);
        addCommentToIssue(linearIssueId, resultsComment)
          .then(() => console.log(chalk.dim(`[Linear] Posted error results comment to ${linearIssueId}`)))
          .catch((err) => console.warn(chalk.yellow(`[Linear] Failed to post error results comment: ${err}`)));
      }

      const run = runningE2ETests.get(issueId);
      if (run) {
        run.status = "completed";
        run.result = result;
      }

      resolve(result);
    });
  });
}

/**
 * Get the status of a running E2E test
 */
export function getE2ETestStatus(issueId: string) {
  return runningE2ETests.get(issueId);
}

/**
 * Get all running E2E tests
 */
export function getAllE2ETests() {
  return Array.from(runningE2ETests.entries()).map(([id, data]) => ({
    issueId: id,
    ...data,
  }));
}
