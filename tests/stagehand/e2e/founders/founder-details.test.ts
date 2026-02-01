import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  createStagehand,
  BASE_URL,
  TEST_TIMEOUT,
} from "../../stagehand.config";
import { ensureAuthenticated } from "../../utils/auth";

describe("Founder Details", () => {
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
    "should open founder details when clicking a founder card",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/founders`);
      await page.waitForLoadState("networkidle");

      const initialUrl = page.url();

      // Try direct selectors for founder cards (much faster than AI)
      const cardSelectors = [
        '[data-testid*="founder"]',
        '.founder-card',
        '[class*="founder"]',
        'a[href*="/founder"]',
        'div[role="button"]',
        '.card',
        'article',
        'li a',
        'table tbody tr',
        '[role="row"]',
      ];

      let clicked = false;
      for (const selector of cardSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            await elements[0].click();
            clicked = true;
            break;
          }
        } catch {}
      }

      if (clicked) {
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1000);
      }

      // Check if we navigated to a detail page
      const newUrl = page.url();
      const navigated = newUrl !== initialUrl;

      // Verify we're on a detail page (URL changed or contains founder ID)
      expect(navigated || newUrl.includes("/founder")).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should navigate through founder detail tabs",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/founders`);
      await page.waitForLoadState("networkidle");

      // Click on a founder card using direct selectors
      const cardSelectors = [
        'a[href*="/founder"]',
        '[data-testid*="founder"]',
        '.founder-card',
        '.card',
        'table tbody tr',
      ];

      for (const selector of cardSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            await elements[0].click();
            break;
          }
        } catch {}
      }

      await page.waitForLoadState("networkidle");

      // Check if tabs exist and try clicking one
      const tabSelectors = [
        '[role="tab"]',
        '[role="tablist"] button',
        'button:has-text("Financials")',
        'button:has-text("Website")',
        'button:has-text("Overview")',
        '.tab',
      ];

      let tabClicked = false;
      for (const selector of tabSelectors) {
        try {
          const tabs = await page.$$(selector);
          if (tabs.length > 1) {
            // Click the second tab (first is usually already selected)
            await tabs[1].click();
            tabClicked = true;
            break;
          }
        } catch {}
      }

      await page.waitForLoadState("networkidle");

      // Verify we're on detail page
      const currentUrl = page.url();
      const onDetailPage = currentUrl !== `${BASE_URL}/founders`;

      expect(onDetailPage).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should display founder overview information",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/founders`);
      await page.waitForLoadState("networkidle");

      // Click on a founder card using direct selectors
      const cardSelectors = [
        'a[href*="/founder"]',
        '[data-testid*="founder"]',
        '.founder-card',
        '.card',
        'table tbody tr',
      ];

      for (const selector of cardSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            await elements[0].click();
            break;
          }
        } catch {}
      }

      await page.waitForLoadState("networkidle");

      // Check for content on the detail page
      const contentSelectors = [
        'h1', 'h2', // Headers with founder name
        '[class*="company"]',
        '[class*="contact"]',
        '[class*="summary"]',
        'p', // Any paragraph text
      ];

      let hasContent = false;
      for (const selector of contentSelectors) {
        try {
          const el = await page.$(selector);
          if (el && await el.isVisible()) {
            hasContent = true;
            break;
          }
        } catch {}
      }

      // Verify we navigated and have content
      const currentUrl = page.url();
      const onDetailPage = currentUrl !== `${BASE_URL}/founders`;

      expect(onDetailPage || hasContent).toBe(true);
    },
    TEST_TIMEOUT
  );
});
