import { Router, Request, Response } from "express";
import { runTestsForIssue } from "../services/stagehand.js";
import { saveTestResult } from "../services/storage.js";
import { testQueue } from "../services/queue.js";
import type { ParsedIssue, TestResult, CriterionResult } from "../types/index.js";

const router = Router();

// Track running tests and their state
interface RunningTest {
  id: string;
  criteria: string[];
  results: CriterionResult[];
  screenshots: string[];
  status: "queued" | "running" | "completed";
  queuePosition?: number;
  result?: TestResult;
  createdAt: number;
}

const runningTests = new Map<string, RunningTest>();

// Clean up old completed tests after 1 hour
const CLEANUP_AFTER_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, test] of runningTests.entries()) {
    if (test.status === "completed" && now - test.createdAt > CLEANUP_AFTER_MS) {
      runningTests.delete(id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[API] Cleaned up ${cleaned} old test records`);
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Generate unique test ID
function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Get config (portal URL from env)
router.get("/config", (_req: Request, res: Response): void => {
  res.json({
    portalUrl: process.env.PORTAL_URL || "",
  });
});

// Start a new test run
router.post("/run-test", async (req: Request, res: Response): Promise<void> => {
  const { criteria } = req.body;

  if (!criteria || !Array.isArray(criteria) || criteria.length === 0) {
    res.status(400).json({ error: "Criteria array is required" });
    return;
  }

  const testId = generateTestId();
  const testState: RunningTest = {
    id: testId,
    criteria,
    results: [],
    screenshots: [],
    status: "queued",
    createdAt: Date.now(),
  };

  runningTests.set(testId, testState);

  const queueStatus = testQueue.getStatus();
  res.json({
    testId,
    message: queueStatus.running >= queueStatus.maxConcurrent ? "Test queued" : "Test started",
    criteria,
    queuePosition: queueStatus.queued + 1,
    queueStatus: {
      running: queueStatus.running,
      queued: queueStatus.queued,
      maxConcurrent: queueStatus.maxConcurrent,
    },
  });

  // Run tests through the queue
  const parsedIssue: ParsedIssue = {
    id: testId,
    identifier: `UI-${testId.slice(-6)}`,
    title: "Manual UI Test",
    acceptanceCriteria: criteria,
    rawDescription: criteria.map((c) => `- [ ] ${c}`).join("\n"),
  };

  // Enqueue the test
  testQueue.enqueue(testId, async () => {
    testState.status = "running";
    
    try {
      const result = await runTestsForIssue(parsedIssue, {
        portalUrl: process.env.PORTAL_URL!,
        username: process.env.PORTAL_USERNAME!,
        password: process.env.PORTAL_PASSWORD!,
      });

      // Update test state
      testState.status = "completed";
      testState.result = result;
      testState.results = result.results;
      testState.screenshots = result.screenshots || [];

      // Save result
      await saveTestResult(result);

      console.log(`[API] Test ${testId} completed: ${result.status}`);
      return result;
    } catch (error) {
      console.error(`[API] Test ${testId} failed:`, error);
      testState.status = "completed";
      testState.result = {
        issueId: testId,
        issueTitle: "Manual UI Test",
        acceptanceCriteria: criteria,
        status: "error",
        results: [],
        timestamp: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }).catch(() => {
    // Error already handled above
  });
});

// Get test status
router.get("/test-status/:testId", (req: Request, res: Response): void => {
  const { testId } = req.params;
  const testState = runningTests.get(testId);

  if (!testState) {
    res.status(404).json({ error: "Test not found" });
    return;
  }

  res.json({
    testId: testState.id,
    status: testState.status,
    queuePosition: testQueue.getPosition(testId),
    criteria: testState.criteria,
    results: testState.results,
    result: testState.result,
  });
});

// Get test screenshots
router.get("/test-screenshots/:testId", (req: Request, res: Response): void => {
  const { testId } = req.params;
  const testState = runningTests.get(testId);

  if (!testState) {
    res.status(404).json({ error: "Test not found" });
    return;
  }

  res.json({
    testId: testState.id,
    screenshots: testState.screenshots,
  });
});

// List all tests
router.get("/tests", (_req: Request, res: Response): void => {
  const tests = Array.from(runningTests.values()).map((t) => ({
    id: t.id,
    status: t.status,
    criteriaCount: t.criteria.length,
    resultsCount: t.results.length,
    createdAt: new Date(t.createdAt).toISOString(),
    queuePosition: testQueue.getPosition(t.id),
  }));

  res.json({
    tests,
    queue: testQueue.getStatus(),
  });
});

// Get queue status
router.get("/queue", (_req: Request, res: Response): void => {
  res.json(testQueue.getStatus());
});

// Update screenshots from stagehand service (called internally)
export function updateTestScreenshots(testId: string, screenshots: string[]): void {
  const testState = runningTests.get(testId);
  if (testState) {
    testState.screenshots = screenshots;
  }
}

// Update results from stagehand service (called internally)
export function updateTestResults(testId: string, results: CriterionResult[]): void {
  const testState = runningTests.get(testId);
  if (testState) {
    testState.results = results;
  }
}

export default router;
