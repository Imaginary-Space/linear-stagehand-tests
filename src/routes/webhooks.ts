import { Router, Request, Response } from "express";
import {
  verifyWebhookSignature,
  parseWebhookPayload,
  parseIssueForTesting,
  shouldTriggerTests,
  shouldTriggerE2ETests,
} from "../services/linear.js";
import { runTestsForIssue } from "../services/stagehand.js";
import { runE2ETests, getE2ETestStatus, getAllE2ETests, e2eEvents } from "../services/e2e-runner.js";
import { saveTestResult } from "../services/storage.js";
import { testQueue } from "../services/queue.js";

const router = Router();

// Track tests by issue ID to prevent duplicates
const issueTests = new Map<string, { status: "queued" | "running" | "completed" }>();

// Track E2E tests by issue ID
const e2eIssueTests = new Map<string, { status: "queued" | "running" | "completed" }>();

// ============================================================================
// E2E Test Webhook - Triggered when issue moves to QA
// ============================================================================

router.post("/linear/e2e", async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers["linear-signature"] as string | undefined;
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET!;

  // Get raw body for signature verification
  const rawBody = (req as any).rawBody as string;

  // Verify webhook signature
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    console.warn("[E2E Webhook] Invalid signature - rejecting request");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse the payload
  const payload = parseWebhookPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid payload format" });
    return;
  }

  console.log(
    `[E2E Webhook] Received ${payload.action} event for ${payload.type}: ${payload.data.title}`
  );

  // Check if this event should trigger E2E tests (issue moved to QA)
  if (!shouldTriggerE2ETests(payload)) {
    console.log("[E2E Webhook] Event does not trigger E2E tests - skipping");
    res.status(200).json({ message: "Event acknowledged, no E2E tests triggered" });
    return;
  }

  const issueId = payload.data.id;
  const issueIdentifier = payload.data.identifier;

  // Prevent duplicate test runs
  const existingTest = e2eIssueTests.get(issueId);
  if (existingTest && existingTest.status !== "completed") {
    console.warn(`[E2E Webhook] E2E tests already ${existingTest.status} for issue ${issueId}`);
    res.status(409).json({
      error: `E2E tests already ${existingTest.status} for this issue`,
      issueId,
    });
    return;
  }

  // Mark as running
  e2eIssueTests.set(issueId, { status: "running" });

  // Acknowledge the webhook immediately
  res.status(202).json({
    message: "E2E tests started",
    issueId,
    issueIdentifier,
    stateName: payload.data.state?.name,
  });

  // Run E2E tests asynchronously
  try {
    const result = await runE2ETests({
      issueId,
      issueIdentifier,
    });

    // TODO: Post results back to Linear as a comment
  } catch (error) {
    console.error(`\n⚠ E2E test error for ${issueIdentifier || issueId}:`, error);
  } finally {
    e2eIssueTests.set(issueId, { status: "completed" });

    // Clean up after 1 hour
    setTimeout(() => {
      e2eIssueTests.delete(issueId);
    }, 60 * 60 * 1000);
  }
});

// Get E2E test status
router.get("/e2e/status/:issueId", (req: Request, res: Response): void => {
  const { issueId } = req.params;
  const status = getE2ETestStatus(issueId);

  if (!status) {
    res.status(404).json({ error: "E2E test not found" });
    return;
  }

  res.json({
    issueId,
    status: status.status,
    output: status.output,
    result: status.result,
    runningFor: status.status === "running" ? Date.now() - status.startedAt : undefined,
  });
});

// List all E2E tests
router.get("/e2e/tests", (_req: Request, res: Response): void => {
  const tests = getAllE2ETests();
  res.json({ tests });
});

// ============================================================================
// Original Acceptance Criteria Webhook
// ============================================================================

router.post("/linear", async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers["linear-signature"] as string | undefined;
  const webhookSecret = process.env.LINEAR_WEBHOOK_SECRET!;

  // Get raw body for signature verification (preserved by express.json verify option)
  const rawBody = (req as any).rawBody as string;

  // Verify webhook signature
  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    console.warn("[Webhook] Invalid signature - rejecting request");
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  // Parse the payload
  const payload = parseWebhookPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: "Invalid payload format" });
    return;
  }

  console.log(
    `[Webhook] Received ${payload.action} event for ${payload.type}: ${payload.data.title}`
  );

  // Check if this event should trigger tests
  if (!shouldTriggerTests(payload)) {
    console.log("[Webhook] Event does not trigger tests - skipping");
    res.status(200).json({ message: "Event acknowledged, no tests triggered" });
    return;
  }

  // Parse the issue for testing
  const parsedIssue = parseIssueForTesting(payload);

  // Check if we have acceptance criteria
  if (parsedIssue.acceptanceCriteria.length === 0) {
    console.warn(
      `[Webhook] No acceptance criteria found for issue ${parsedIssue.identifier || parsedIssue.id}`
    );
    res.status(200).json({
      message: "No acceptance criteria found in issue description",
      issueId: parsedIssue.id,
    });
    return;
  }

  // Prevent duplicate test runs for the same issue
  const existingTest = issueTests.get(parsedIssue.id);
  if (existingTest && existingTest.status !== "completed") {
    console.warn(`[Webhook] Tests already ${existingTest.status} for issue ${parsedIssue.id}`);
    res.status(409).json({
      error: `Tests already ${existingTest.status} for this issue`,
      issueId: parsedIssue.id,
    });
    return;
  }

  // Mark as queued
  issueTests.set(parsedIssue.id, { status: "queued" });

  const queueStatus = testQueue.getStatus();

  // Acknowledge the webhook immediately
  res.status(202).json({
    message: queueStatus.running >= queueStatus.maxConcurrent ? "Tests queued" : "Tests started",
    issueId: parsedIssue.id,
    issueIdentifier: parsedIssue.identifier,
    acceptanceCriteria: parsedIssue.acceptanceCriteria,
    queue: {
      position: queueStatus.queued + 1,
      running: queueStatus.running,
      maxConcurrent: queueStatus.maxConcurrent,
    },
  });

  // Run tests through the queue
  testQueue.enqueue(parsedIssue.id, async () => {
    issueTests.set(parsedIssue.id, { status: "running" });

    try {
      console.log(
        `[Webhook] Starting tests for issue ${parsedIssue.identifier || parsedIssue.id}`
      );

      const testResult = await runTestsForIssue(parsedIssue, {
        portalUrl: process.env.PORTAL_URL!,
        username: process.env.PORTAL_USERNAME!,
        password: process.env.PORTAL_PASSWORD!,
      });

      // Save the test result
      const resultPath = await saveTestResult(testResult);

      console.log(
        `[Webhook] Tests completed for ${parsedIssue.identifier || parsedIssue.id} - Status: ${testResult.status}`
      );
      console.log(`[Webhook] Results saved to ${resultPath}`);

      // TODO: Optionally post results back to Linear as a comment
      // This could be implemented using the Linear API

      return testResult;
    } catch (error) {
      console.error(
        `[Webhook] Error running tests for ${parsedIssue.identifier || parsedIssue.id}:`,
        error
      );
      throw error;
    } finally {
      issueTests.set(parsedIssue.id, { status: "completed" });
      
      // Clean up after 1 hour
      setTimeout(() => {
        issueTests.delete(parsedIssue.id);
      }, 60 * 60 * 1000);
    }
  }).catch(() => {
    // Error already logged above
  });
});

// Health check endpoint
router.get("/health", (_req: Request, res: Response): void => {
  const queueStatus = testQueue.getStatus();
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    queue: queueStatus,
  });
});

export default router;
