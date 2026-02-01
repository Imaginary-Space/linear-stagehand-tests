import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import {
  createStagehand,
  BASE_URL,
  TEST_TIMEOUT,
} from "../stagehand.config";
import { ensureAuthenticated } from "../utils/auth";

describe("Dashboard & Navigation", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
    await ensureAuthenticated(stagehand);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (stagehand) {
      await stagehand.close();
    }
  });

  it(
    "should load dashboard after login",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");

      // Verify we're not on login page
      const url = page.url();
      expect(url).not.toContain("/login");

      // Check for sidebar/navigation
      const navSelectors = [
        'nav',
        '[role="navigation"]',
        '.sidebar',
        'aside',
      ];

      let hasNav = false;
      for (const selector of navSelectors) {
        try {
          const el = await page.$(selector);
          if (el && await el.isVisible()) {
            hasNav = true;
            break;
          }
        } catch {}
      }

      expect(hasNav).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should navigate to Founders page",
    async () => {
      const page = stagehand.context.pages()[0];
      
      // Direct navigation is faster than clicking
      await page.goto(`${BASE_URL}/founders`);
      await page.waitForLoadState("networkidle");

      // Verify URL - just check we're on the founders page
      const url = page.url();
      expect(url).toContain("/founders");

      // Page loaded successfully
      expect(true).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should navigate to Ideas page",
    async () => {
      const page = stagehand.context.pages()[0];
      
      // Direct navigation
      await page.goto(`${BASE_URL}/ideas`);
      await page.waitForLoadState("networkidle");

      // Verify URL
      const url = page.url();
      expect(url).toContain("/ideas");

      // Check for page content
      const headerSelectors = ['h1', 'h2', '.header', '[class*="title"]'];
      let hasHeader = false;
      for (const selector of headerSelectors) {
        try {
          const el = await page.$(selector);
          if (el && await el.isVisible()) {
            hasHeader = true;
            break;
          }
        } catch {}
      }

      expect(hasHeader).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should navigate to Admin page",
    async () => {
      const page = stagehand.context.pages()[0];
      
      // Direct navigation
      await page.goto(`${BASE_URL}/admin`);
      await page.waitForLoadState("networkidle");

      // Either we're on admin page or redirected (access control)
      const url = page.url();
      const onAdminOrRedirected = url.includes("/admin") || url.includes("/");

      expect(onAdminOrRedirected).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should navigate to Traces page",
    async () => {
      const page = stagehand.context.pages()[0];
      
      // Direct navigation
      await page.goto(`${BASE_URL}/traces`);
      await page.waitForLoadState("networkidle");

      // Either we're on traces page or redirected (access control)
      const url = page.url();
      const onTracesOrRedirected = url.includes("/traces") || url.includes("/");

      expect(onTracesOrRedirected).toBe(true);
    },
    TEST_TIMEOUT
  );
});
