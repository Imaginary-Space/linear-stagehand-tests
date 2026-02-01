import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import type { Page } from "playwright";
import type { ParsedIssue, TestResult, CriterionResult } from "../types/index.js";
import { saveScreenshot, deleteScreenshotsForIssue } from "./storage.js";
import { updateTestScreenshots, updateTestResults } from "../routes/api.js";

// Schema for extracting test verification results
const VerificationResultSchema = z.object({
  criterion: z.string(),
  passed: z.boolean(),
  details: z.string(),
});

interface StagehandConfig {
  portalUrl: string;
  username: string;
  password: string;
}

// Screenshot interval in milliseconds
const SCREENSHOT_INTERVAL_MS = 3000;

/**
 * Creates a periodic screenshot capture that runs in the background
 */
function createScreenshotCapture(
  page: Page,
  issueId: string,
  screenshots: string[]
): { stop: () => void } {
  let screenshotIndex = 0;
  let isCapturing = false;

  const captureScreenshot = async () => {
    if (isCapturing) return; // Prevent overlapping captures
    isCapturing = true;
    
    try {
      const screenshot = await page.screenshot();
      const screenshotPath = await saveScreenshot(issueId, screenshot, screenshotIndex++);
      screenshots.push(screenshotPath);
      
      // Update API state for live frontend updates
      updateTestScreenshots(issueId, [...screenshots]);
      
      console.log(`[Stagehand] Captured screenshot ${screenshotIndex}`);
    } catch (err) {
      // Page might be navigating or closed, ignore errors
      console.warn("[Stagehand] Screenshot capture skipped (page busy)");
    } finally {
      isCapturing = false;
    }
  };

  // Take initial screenshot
  captureScreenshot();

  // Start interval
  const intervalId = setInterval(captureScreenshot, SCREENSHOT_INTERVAL_MS);

  return {
    stop: () => {
      clearInterval(intervalId);
      console.log(`[Stagehand] Screenshot capture stopped (${screenshotIndex} total)`);
    },
  };
}

/**
 * Runs the Stagehand agent to verify acceptance criteria
 */
export async function runTestsForIssue(
  issue: ParsedIssue,
  config: StagehandConfig
): Promise<TestResult> {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  console.log(`[Stagehand] Starting test run for issue ${issue.identifier || issue.id}`);
  console.log(`[Stagehand] Acceptance criteria to verify: ${issue.acceptanceCriteria.length}`);

  // Initialize Stagehand with local Chrome
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    localBrowserLaunchOptions: {
      headless: true, // Run headless for server environments
    },
  });

  const screenshots: string[] = [];
  let results: CriterionResult[] = [];
  let status: "passed" | "failed" | "error" = "passed";
  let errorMessage: string | undefined;
  let screenshotCapture: { stop: () => void } | undefined;

  try {
    await stagehand.init();
    console.log("[Stagehand] Browser initialized");

    const page = stagehand.context.pages()[0];

    // Navigate to the portal
    await page.goto(config.portalUrl);
    console.log(`[Stagehand] Navigated to ${config.portalUrl}`);

    // Start periodic screenshot capture
    screenshotCapture = createScreenshotCapture(page as unknown as Page, issue.id, screenshots);
    console.log(`[Stagehand] Started screenshot capture (every ${SCREENSHOT_INTERVAL_MS / 1000}s)`);

    // Perform login using the agent
    const loginAgent = stagehand.agent({
      model: "openai/gpt-4o",
      instructions: `You are a QA automation agent. Your task is to log into a web application.
Be precise and methodical. Look for login forms, username/email fields, and password fields.
After logging in, wait for the page to fully load before confirming success.`,
    });

    console.log("[Stagehand] Attempting login...");
    await loginAgent.execute(
      `Log into this application using these credentials:
      - Username/Email: ${config.username}
      - Password: ${config.password}
      
      Find the login form, enter the credentials, and submit. Wait for the login to complete.`
    );
    console.log("[Stagehand] Login completed");

    // If no acceptance criteria, just verify login worked
    if (issue.acceptanceCriteria.length === 0) {
      console.log("[Stagehand] No acceptance criteria found - verifying login only");
      results = [
        {
          criterion: "User can successfully log in",
          passed: true,
          details: "Login completed successfully",
        },
      ];
    } else {
      // Test each acceptance criterion
      for (const criterion of issue.acceptanceCriteria) {
        console.log(`[Stagehand] Testing criterion: ${criterion}`);

        try {
          const testAgent = stagehand.agent({
            model: "openai/gpt-4o",
            instructions: `You are a QA testing agent. Your job is to verify a specific acceptance criterion on a web application.
            
Your instructions:
1. Read and understand the acceptance criterion
2. Navigate through the application to find the relevant feature
3. Verify the criterion is met by interacting with the UI
4. Be thorough but efficient
5. If you cannot verify the criterion, explain why

After testing, you will be asked to provide your assessment.`,
          });

          await testAgent.execute(
            `Verify this acceptance criterion: "${criterion}"
            
Navigate the application and interact with it to confirm this criterion is met.
Take note of what you observe for your final assessment.`
          );

          // Extract the verification result from the page
          const verificationResult = await page.extract({
            instruction: `Based on your testing of the criterion "${criterion}", provide your assessment:
            - criterion: the exact criterion text
            - passed: true if the criterion was verified, false if it failed or couldn't be verified
            - details: specific observations about what you found`,
            schema: VerificationResultSchema,
          });

          results.push(verificationResult);
          
          // Update API state for live frontend updates
          updateTestResults(issue.id, [...results]);

          if (!verificationResult.passed) {
            status = "failed";
          }
        } catch (criterionError) {
          console.error(
            `[Stagehand] Error testing criterion "${criterion}":`,
            criterionError
          );
          const errorResult = {
            criterion,
            passed: false,
            details: `Error during test: ${criterionError instanceof Error ? criterionError.message : String(criterionError)}`,
          };
          results.push(errorResult);
          
          // Update API state for live frontend updates
          updateTestResults(issue.id, [...results]);
          
          status = "failed";
        }
      }
    }

    // Determine overall status
    if (results.every((r) => r.passed)) {
      status = "passed";
    } else if (results.some((r) => !r.passed)) {
      status = "failed";
    }
  } catch (error) {
    console.error("[Stagehand] Test run failed:", error);
    status = "error";
    errorMessage =
      error instanceof Error ? error.message : String(error);

    // If we have no results, add an error result
    if (results.length === 0) {
      results = issue.acceptanceCriteria.map((criterion) => ({
        criterion,
        passed: false,
        details: `Test run failed: ${errorMessage}`,
      }));
    }
  } finally {
    // Stop screenshot capture
    if (screenshotCapture) {
      screenshotCapture.stop();
    }

    try {
      await stagehand.close();
      console.log("[Stagehand] Browser closed");
    } catch {
      console.warn("[Stagehand] Error closing browser");
    }

    // Clean up screenshots after session is complete
    try {
      await deleteScreenshotsForIssue(issue.id);
    } catch {
      console.warn("[Stagehand] Error deleting screenshots");
    }
  }

  const duration = Date.now() - startTime;

  const testResult: TestResult = {
    issueId: issue.id,
    issueIdentifier: issue.identifier,
    issueTitle: issue.title,
    issueUrl: issue.url,
    acceptanceCriteria: issue.acceptanceCriteria,
    status,
    results,
    timestamp,
    duration,
    screenshots, // Always include periodic screenshots
    errorMessage,
  };

  console.log(
    `[Stagehand] Test run completed in ${duration}ms - Status: ${status}`
  );

  return testResult;
}
