import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";
import {
  createStagehand,
  BASE_URL,
  TEST_TIMEOUT,
} from "../stagehand.config";
import { ensureAuthenticated, executeAction } from "../utils/auth";

describe("Annie Chat", () => {
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
    "should load chat container on main dashboard",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");

      const chatResult = await page.extract({
        instruction: "Is the unified chat container visible?",
        schema: z.object({
          visible: z.boolean().describe("Is the chat container visible?"),
          hasInputField: z.boolean().describe("Is there a chat input field visible?"),
        }),
      });

      expect(chatResult.visible).toBe(true);
      expect(chatResult.hasInputField).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should load chat container on Annie route",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/annie`);
      await page.waitForLoadState("networkidle");

      const chatResult = await page.extract({
        instruction: "Is the unified chat container visible on the Annie page?",
        schema: z.object({
          visible: z.boolean().describe("Is the chat container visible?"),
        }),
      });

      expect(chatResult.visible).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should create a new chat session",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");

      // Click new chat button using agent
      await executeAction(stagehand, "Click the new chat button to create a new conversation");

      // Check if confirmation dialog appears or new session is created
      const result = await page.extract({
        instruction: "Check if a new chat session was created or if a confirmation dialog appeared",
        schema: z.object({
          confirmDialogVisible: z.boolean().describe("Is there a confirmation dialog visible?"),
          newSessionCreated: z.boolean().describe("Is a new chat session visible in the list?"),
        }),
      });

      // If confirmation dialog is visible, confirm it
      if (result.confirmDialogVisible) {
        await executeAction(stagehand, "Click the confirm button to create the chat");
        await page.waitForLoadState("networkidle");
      }

      // Verify new session exists
      const finalResult = await page.extract({
        instruction: "Is there a chat session visible in the sessions list?",
        schema: z.object({
          sessionVisible: z.boolean().describe("Is at least one chat session visible?"),
        }),
      });

      expect(finalResult.sessionVisible).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should send a message and see it appear in chat",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");

      const testMessage = "Hello, this is a test message";

      // Type and send message using agent
      await executeAction(
        stagehand,
        `Type "${testMessage}" into the chat input and click the send button to send the message`
      );

      // Wait for message to appear
      await page.waitForLoadState("networkidle");

      const messageResult = await page.extract({
        instruction: `Check if the message "${testMessage}" appears in the chat`,
        schema: z.object({
          messageVisible: z.boolean().describe("Is the test message visible in the chat?"),
          messageContent: z.string().optional().describe("What is the message content?"),
        }),
      });

      expect(messageResult.messageVisible).toBe(true);
    },
    TEST_TIMEOUT
  );

  it(
    "should display chat history",
    async () => {
      const page = stagehand.context.pages()[0];
      await page.goto(`${BASE_URL}/`);
      await page.waitForLoadState("networkidle");

      const historyResult = await page.extract({
        instruction: "Check if there is a chat history or sessions list visible",
        schema: z.object({
          historyVisible: z.boolean().describe("Is the chat history or sessions list visible?"),
          sessionCount: z.number().describe("How many chat sessions are visible?"),
        }),
      });

      // History should be visible (may be empty for new users)
      expect(historyResult.historyVisible).toBe(true);
    },
    TEST_TIMEOUT
  );
});
