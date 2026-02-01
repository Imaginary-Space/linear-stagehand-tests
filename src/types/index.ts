import { z } from "zod";

// =============================================================================
// Environment Configuration
// =============================================================================

export const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  PORTAL_URL: z.string().url("PORTAL_URL must be a valid URL"),
  PORTAL_USERNAME: z.string().min(1, "PORTAL_USERNAME is required"),
  PORTAL_PASSWORD: z.string().min(1, "PORTAL_PASSWORD is required"),
  LINEAR_WEBHOOK_SECRET: z.string().min(1, "LINEAR_WEBHOOK_SECRET is required"),
  LINEAR_API_KEY: z.string().min(1, "LINEAR_API_KEY is required for posting comments"),
  LINEAR_TEST_ID: z.string().optional(), // Default issue for test comments (e.g., "FEL-395")
  // Browserbase for cloud browser automation (required for production)
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  PORT: z.string().default("3000"),
});

export type Env = z.infer<typeof EnvSchema>;

// =============================================================================
// Linear Webhook Payload
// =============================================================================

export const LinearIssueSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  identifier: z.string().optional(), // e.g., "ENG-123"
  url: z.string().url().optional(),
  state: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
  labels: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
      })
    )
    .optional(),
});

export type LinearIssue = z.infer<typeof LinearIssueSchema>;

export const LinearWebhookPayloadSchema = z.object({
  action: z.enum(["create", "update", "remove"]),
  type: z.string(), // "Issue", "Comment", etc.
  data: LinearIssueSchema,
  url: z.string().optional(),
  createdAt: z.string().optional(),
});

export type LinearWebhookPayload = z.infer<typeof LinearWebhookPayloadSchema>;

// =============================================================================
// Test Results
// =============================================================================

export const CriterionResultSchema = z.object({
  criterion: z.string(),
  passed: z.boolean(),
  details: z.string(),
});

export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const TestResultSchema = z.object({
  issueId: z.string(),
  issueIdentifier: z.string().optional(), // e.g., "ENG-123"
  issueTitle: z.string(),
  issueUrl: z.string().optional(),
  acceptanceCriteria: z.array(z.string()),
  status: z.enum(["passed", "failed", "error"]),
  results: z.array(CriterionResultSchema),
  timestamp: z.string(),
  duration: z.number().optional(), // in milliseconds
  screenshots: z.array(z.string()).optional(),
  errorMessage: z.string().optional(),
});

export type TestResult = z.infer<typeof TestResultSchema>;

// =============================================================================
// Parsed Acceptance Criteria
// =============================================================================

export interface ParsedIssue {
  id: string;
  identifier?: string;
  title: string;
  url?: string;
  acceptanceCriteria: string[];
  rawDescription: string | null;
}
