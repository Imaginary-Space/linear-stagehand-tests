import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import { BASE_URL, AI_MODEL } from "../stagehand.config";
import { loadCookies, loadAuthState } from "../global-setup";

/**
 * Schema for login result verification
 */
export const LoginResultSchema = z.object({
  sidebarVisible: z.boolean().describe("Is the sidebar navigation visible?"),
  errorVisible: z.boolean().describe("Is there an error message visible?"),
  errorMessage: z.string().optional().describe("The error message text if visible"),
});

export type LoginResult = z.infer<typeof LoginResultSchema>;

/**
 * Ensures the user is authenticated using cached auth state (cookies + localStorage)
 * Falls back to direct login if cached auth fails
 */
export async function ensureAuthenticated(stagehand: Stagehand): Promise<void> {
  const page = stagehand.context.pages()[0];
  const username = process.env.PORTAL_USERNAME;
  const password = process.env.PORTAL_PASSWORD;

  if (!username || !password) {
    throw new Error("PORTAL_USERNAME and PORTAL_PASSWORD required for login");
  }

  // Load cached auth state (includes both cookies and localStorage)
  const authState = loadAuthState();
  
  // Check if token is expired before trying to use it
  let tokenValid = false;
  if (authState?.localStorage) {
    const authToken = Object.entries(authState.localStorage).find(([key]) => 
      key.includes("auth-token")
    );
    if (authToken) {
      try {
        const tokenData = JSON.parse(authToken[1]);
        const expiresAt = tokenData.expires_at;
        const nowSec = Math.floor(Date.now() / 1000);
        tokenValid = expiresAt > nowSec + 60; // At least 1 minute remaining
      } catch {}
    }
  }
  
  if (authState && tokenValid) {
    // Restore cookies if any
    if (authState.cookies && authState.cookies.length > 0) {
      await stagehand.context.addCookies(authState.cookies);
    }
    
    // Navigate first so we can set localStorage on the correct origin
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    
    // Restore localStorage (needed for JWT-based auth)
    if (authState.localStorage && Object.keys(authState.localStorage).length > 0) {
      await page.evaluate((items) => {
        for (const [key, value] of Object.entries(items)) {
          window.localStorage.setItem(key, value);
        }
      }, authState.localStorage);
      
      // Reload to apply localStorage auth
      await page.reload();
      await page.waitForLoadState("networkidle");
    }

    // Check if we're authenticated after applying cached auth
    if (!page.url().includes("/login")) {
      return; // Successfully authenticated with cached auth
    }
  }

  // Cached auth failed or expired - do a fresh login
  console.log("  → Cached auth invalid/expired, performing fresh login...");
  
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  
  await loginDirect(stagehand, username, password);
  await page.waitForLoadState("networkidle");
  
  // Wait a bit for auth to settle
  await page.waitForTimeout(1000);
  
  // Final check
  const finalUrl = page.url();
  if (finalUrl.includes("/login")) {
    // Try one more time with a longer wait
    await page.waitForTimeout(2000);
    const retryUrl = page.url();
    if (retryUrl.includes("/login")) {
      throw new Error(`Login failed - still on login page. URL: ${retryUrl}`);
    }
  }
}

/**
 * Legacy login function - uses AI agent
 * Only use this if cached auth doesn't work
 */
export async function loginWithAgent(
  stagehand: Stagehand,
  email: string,
  password: string
): Promise<LoginResult> {
  const page = stagehand.context.pages()[0];
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");

  const agent = stagehand.agent({
    model: AI_MODEL,
    instructions: "You are a QA automation agent. Be precise when filling forms.",
  });

  await agent.execute(
    `Log into this application:
    1. Type "${email}" into the email input field
    2. Type "${password}" into the password input field
    3. Click the Login button to submit the form
    Wait for the page to load after submitting.`
  );

  await page.waitForLoadState("networkidle");

  const result = await page.extract({
    instruction: "Check if login was successful",
    schema: LoginResultSchema,
  });

  return result;
}

/**
 * Fast login using direct Playwright selectors (~2-3s)
 */
export async function loginDirect(
  stagehand: Stagehand,
  email: string,
  password: string
): Promise<void> {
  const page = stagehand.context.pages()[0];
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");

  // Try common selectors
  const emailSelectors = [
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="email" i]',
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
  ];

  // Fill email
  for (const selector of emailSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.fill(email);
        break;
      }
    } catch {}
  }

  // Fill password
  for (const selector of passwordSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.fill(password);
        break;
      }
    } catch {}
  }

  // Submit
  for (const selector of submitSelectors) {
    try {
      const el = await page.$(selector);
      if (el) {
        await el.click();
        break;
      }
    } catch {}
  }

  await page.waitForLoadState("networkidle");
}

/**
 * Navigates to a specific route (assumes already authenticated)
 */
export async function navigateTo(
  stagehand: Stagehand,
  route: string
): Promise<void> {
  const page = stagehand.context.pages()[0];
  await page.goto(`${BASE_URL}${route}`);
  await page.waitForLoadState("networkidle");
}

/**
 * Helper to execute an action using the agent
 * Uses gpt-4o-mini for faster execution
 */
export async function executeAction(
  stagehand: Stagehand,
  instruction: string
): Promise<void> {
  const agent = stagehand.agent({
    model: AI_MODEL,
    instructions: "You are a QA automation agent. Be precise and efficient.",
  });
  await agent.execute(instruction);
}

// ============================================================================
// DEPRECATED - Use ensureAuthenticated instead
// ============================================================================

/**
 * @deprecated Use ensureAuthenticated instead for faster tests
 */
export async function ensureLoggedIn(
  stagehand: Stagehand,
  email: string,
  password: string
): Promise<void> {
  // First try cached auth
  try {
    await ensureAuthenticated(stagehand);
    return;
  } catch {
    // Fall back to direct login
    await loginDirect(stagehand, email, password);
  }
}

/**
 * @deprecated Use ensureAuthenticated instead
 */
export async function login(
  stagehand: Stagehand,
  email: string,
  password: string
): Promise<LoginResult> {
  return loginWithAgent(stagehand, email, password);
}
