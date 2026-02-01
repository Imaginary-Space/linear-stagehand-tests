import { Stagehand } from "@browserbasehq/stagehand";
import dotenv from "dotenv";
import path from "path";
import { loadCookies } from "./global-setup";

// Load environment variables - explicitly specify path for spawned processes
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

export interface EnvConfig {
  portalUsername: string;
  portalPassword: string;
  openaiApiKey: string;
}

/**
 * Get environment variables required for testing
 */
export function getEnvConfig(): EnvConfig {
  const portalUsername = process.env.PORTAL_USERNAME;
  const portalPassword = process.env.PORTAL_PASSWORD;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  if (!portalUsername || !portalPassword) {
    throw new Error("PORTAL_USERNAME and PORTAL_PASSWORD environment variables are required");
  }

  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }

  return {
    portalUsername,
    portalPassword,
    openaiApiKey,
  };
}

/**
 * Check if Browserbase is configured for cloud browser automation
 */
export function useBrowserbase(): boolean {
  return !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
}

/**
 * Creates and initializes a Stagehand instance for testing
 * Automatically loads cached auth cookies if available
 * Uses Browserbase in production, local Chrome in development
 */
export async function createStagehand(): Promise<Stagehand> {
  const cloudMode = useBrowserbase();
  
  const stagehand = new Stagehand({
    env: cloudMode ? "BROWSERBASE" : "LOCAL",
    verbose: 0,
    ...(cloudMode ? {
      apiKey: process.env.BROWSERBASE_API_KEY,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
    } : {
      localBrowserLaunchOptions: {
        headless: true,
      },
    }),
  });

  await stagehand.init();

  // Load cached cookies for authentication
  const cookies = loadCookies();
  if (cookies.length > 0) {
    await stagehand.context.addCookies(cookies);
  }

  return stagehand;
}

/**
 * Creates a Stagehand instance with cached auth already applied
 * Use this instead of createStagehand + ensureLoggedIn for faster tests
 */
export async function createAuthenticatedStagehand(): Promise<Stagehand> {
  const stagehand = await createStagehand();

  // Navigate to base to apply cookies
  const page = stagehand.context.pages()[0];
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");

  return stagehand;
}

/**
 * Base URL for the application under test
 */
export const BASE_URL = process.env.PORTAL_URL || "http://localhost:5173";

/**
 * AI Model to use for Stagehand operations
 * gpt-4.1-mini is faster and smarter than gpt-4o-mini with 1M context window
 */
export const AI_MODEL = "openai/gpt-4.1-mini";

/**
 * Test timeout for browser automation tests (in milliseconds)
 * Reduced since we're using faster model and cached auth
 */
export const TEST_TIMEOUT = 60000; // 60 seconds per test
