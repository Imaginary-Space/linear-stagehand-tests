import { Stagehand } from "@browserbasehq/stagehand";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// Use project root for auth files to ensure consistency across all run contexts
const AUTH_DIR = path.join(process.cwd(), "tests", "stagehand");
const COOKIES_PATH = path.join(AUTH_DIR, ".cookies.json");
const STATE_PATH = path.join(AUTH_DIR, ".auth-state.json");

export interface AuthState {
  cookies: any[];
  localStorage: Record<string, string>;
  timestamp: number;
}

/**
 * Global setup - runs once before all tests
 * Logs in and saves authentication state for reuse
 */
export async function setup() {
  console.log("\n🔧 Global Setup: Initializing browser and logging in...\n");

  const portalUrl = process.env.PORTAL_URL || "http://localhost:5173";
  const username = process.env.PORTAL_USERNAME;
  const password = process.env.PORTAL_PASSWORD;

  if (!username || !password) {
    throw new Error("PORTAL_USERNAME and PORTAL_PASSWORD are required");
  }

  // Check if we have valid cached auth
  if (fs.existsSync(STATE_PATH)) {
    try {
      const state: AuthState = JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
      const ageMs = Date.now() - state.timestamp;
      const ageMinutes = Math.floor(ageMs / 60000);

      // Check if JWT token is close to expiry (within 10 minutes)
      let tokenExpired = false;
      if (state.localStorage) {
        const authToken = Object.entries(state.localStorage).find(([key]) => 
          key.includes("auth-token")
        );
        if (authToken) {
          try {
            const tokenData = JSON.parse(authToken[1]);
            const expiresAt = tokenData.expires_at;
            const nowSec = Math.floor(Date.now() / 1000);
            const timeRemaining = expiresAt - nowSec;
            if (timeRemaining < 600) { // Less than 10 minutes remaining
              console.log(`⚠ Token expires in ${Math.floor(timeRemaining / 60)}m, re-authenticating...\n`);
              tokenExpired = true;
            }
          } catch {}
        }
      }

      if (!tokenExpired && ageMs < 60 * 60 * 1000) {
        // Less than 1 hour old and token not expired
        console.log(`✓ Using cached auth state (${ageMinutes}m old)\n`);
        return;
      }
      
      if (!tokenExpired) {
        console.log(`⚠ Cached auth expired (${ageMinutes}m old), re-authenticating...\n`);
      }
    } catch {
      console.log("⚠ Invalid cached auth, re-authenticating...\n");
    }
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    localBrowserLaunchOptions: {
      headless: true,
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.context.pages()[0];

    // Navigate to login
    await page.goto(`${portalUrl}/login`);
    await page.waitForLoadState("networkidle");

    // Use direct Playwright for fast login (no AI overhead)
    console.log("  → Filling login form...");

    // Try common selectors for email/password fields
    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[placeholder*="email" i]',
      'input[placeholder*="Email" i]',
      "#email",
    ];

    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      "#password",
    ];

    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("Log in")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
      'input[type="submit"]',
    ];

    // Find and fill email
    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.fill(username);
          emailFilled = true;
          break;
        }
      } catch {}
    }

    if (!emailFilled) {
      // Fallback to AI
      console.log("  → Using AI fallback for email field...");
      const agent = stagehand.agent({
        model: "openai/gpt-4o-mini",
        instructions: "Fill in the login form fields precisely.",
      });
      await agent.execute(`Type "${username}" into the email input field`);
    }

    // Find and fill password
    let passwordFilled = false;
    for (const selector of passwordSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.fill(password);
          passwordFilled = true;
          break;
        }
      } catch {}
    }

    if (!passwordFilled) {
      console.log("  → Using AI fallback for password field...");
      const agent = stagehand.agent({
        model: "openai/gpt-4o-mini",
        instructions: "Fill in the login form fields precisely.",
      });
      await agent.execute(`Type "${password}" into the password input field`);
    }

    // Submit form
    console.log("  → Submitting login form...");
    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        const el = await page.$(selector);
        if (el) {
          await el.click();
          submitted = true;
          break;
        }
      } catch {}
    }

    if (!submitted) {
      console.log("  → Using AI fallback for submit...");
      const agent = stagehand.agent({
        model: "openai/gpt-4o-mini",
        instructions: "Submit the login form.",
      });
      await agent.execute("Click the login/submit button");
    }

    // Wait for navigation
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000); // Extra wait for auth to settle

    // Verify login succeeded
    const currentUrl = page.url();
    if (currentUrl.includes("/login")) {
      console.log("  ✗ Login failed - still on login page");
      console.log(`    Current URL: ${currentUrl}`);
      throw new Error("Global setup login failed - check credentials");
    }

    // Get cookies
    const cookies = await stagehand.context.cookies();

    // Get localStorage (if needed)
    const localStorage = await page.evaluate(() => {
      const items: Record<string, string> = {};
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key) {
          items[key] = window.localStorage.getItem(key) || "";
        }
      }
      return items;
    });

    // Save auth state
    const authState: AuthState = {
      cookies,
      localStorage,
      timestamp: Date.now(),
    };

    fs.writeFileSync(STATE_PATH, JSON.stringify(authState, null, 2));
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));

    const localStorageCount = Object.keys(localStorage).length;
    console.log(`  ✓ Logged in and saved ${cookies.length} cookies, ${localStorageCount} localStorage items\n`);
  } finally {
    await stagehand.close();
  }
}

/**
 * Global teardown - runs once after all tests
 */
export async function teardown() {
  console.log("\n🧹 Global Teardown: Cleaning up...\n");
  // Optionally clear auth state
  // fs.unlinkSync(STATE_PATH);
}

/**
 * Load saved auth state
 */
export function loadAuthState(): AuthState | null {
  if (!fs.existsSync(STATE_PATH)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Load saved cookies
 */
export function loadCookies(): any[] {
  if (!fs.existsSync(COOKIES_PATH)) {
    return [];
  }
  try {
    return JSON.parse(fs.readFileSync(COOKIES_PATH, "utf-8"));
  } catch {
    return [];
  }
}
