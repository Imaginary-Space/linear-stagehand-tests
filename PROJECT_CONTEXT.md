# Linear Stagehand Tests - Project Context

## Overview

**Linear Stagehand Tests** is an automated testing infrastructure that runs browser tests when Linear tickets are moved to a testing state. The system uses [Stagehand](https://github.com/browserbase/stagehand) for AI-driven browser automation, powered by OpenAI's GPT-4o model.

### Architecture Flow

```
Linear Webhook → Express Server → Parse ACs → Stagehand Agent → Local Chrome → Test Results
```

## Technology Stack

### Core Technologies
- **Runtime**: Node.js 18+ (TypeScript)
- **Framework**: Express.js 4.21.0
- **Browser Automation**: Stagehand 2.0.0 (uses Playwright under the hood)
- **AI Model**: OpenAI GPT-4o (via Stagehand)
- **Validation**: Zod 3.23.8
- **Environment**: dotenv 16.4.5

### Development Tools
- **TypeScript**: 5.6.0
- **Build Tool**: tsx 4.19.0 (for dev/watch mode)
- **Playwright**: 1.58.1 (dependency of Stagehand)

### Deployment
- **Containerization**: Docker with multi-stage build
- **Orchestration**: Docker Compose
- **Base Image**: node:20-slim

## Project Structure

```
linear-stagehand-tests/
├── src/
│   ├── index.ts              # Express server entry point
│   ├── routes/
│   │   ├── api.ts            # REST API endpoints for manual testing
│   │   └── webhooks.ts       # Linear webhook handler
│   ├── services/
│   │   ├── stagehand.ts      # Stagehand agent setup & test execution
│   │   ├── linear.ts         # Linear webhook parsing & AC extraction
│   │   ├── queue.ts          # Concurrent test execution queue
│   │   └── storage.ts        # Test result & screenshot storage
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces & Zod schemas
│   └── test-manual.ts        # Manual test script
├── public/
│   └── index.html            # Web UI for manual testing
├── test-results/             # JSON test results (gitignored)
├── screenshots/              # Test screenshots (gitignored)
├── scripts/
│   └── test-webhook.sh       # Webhook testing script
├── .env.example              # Environment variable template
├── docker-compose.yml        # Docker Compose configuration
├── Dockerfile                # Multi-stage Docker build
├── tsconfig.json             # TypeScript configuration
├── package.json              # Dependencies & scripts
└── README.md                 # Project documentation
```

## Key Components

### 1. Server Entry (`src/index.ts`)
- Validates environment variables using Zod schema
- Sets up Express app with JSON body parsing (preserves raw body for webhook signature verification)
- Serves static files (public UI, screenshots)
- Mounts webhook and API routes
- Starts server on configured port

### 2. Webhook Handler (`src/routes/webhooks.ts`)
- **POST `/webhooks/linear`**: Receives Linear webhook events
  - Verifies webhook signature using HMAC SHA-256
  - Parses webhook payload
  - Checks if issue should trigger tests (state-based or label-based)
  - Extracts acceptance criteria from issue description
  - Prevents duplicate test runs for same issue
  - Enqueues tests for execution
  - Returns 202 Accepted immediately (async processing)
- **GET `/webhooks/health`**: Health check endpoint with queue status

### 3. API Routes (`src/routes/api.ts`)
- **GET `/api/config`**: Returns portal URL configuration
- **POST `/api/run-test`**: Starts manual test run with provided criteria
- **GET `/api/test-status/:testId`**: Gets current status of a test
- **GET `/api/test-screenshots/:testId`**: Gets screenshots for a test
- **GET `/api/tests`**: Lists all tests with queue status
- **GET `/api/queue`**: Returns queue status (running, queued, max concurrent)

### 4. Stagehand Service (`src/services/stagehand.ts`)
- Initializes Stagehand with local Chrome (headless mode)
- Navigates to portal URL
- Performs login using AI agent
- Tests each acceptance criterion sequentially:
  - Creates dedicated agent for each criterion
  - Executes verification task
  - Extracts result using page extraction with Zod schema
- Captures periodic screenshots (every 3 seconds)
- Updates API state for live frontend updates
- Returns comprehensive test result

### 5. Linear Service (`src/services/linear.ts`)
- **`verifyWebhookSignature()`**: HMAC SHA-256 signature verification
- **`parseWebhookPayload()`**: Validates webhook payload structure
- **`extractAcceptanceCriteria()`**: Extracts ACs from issue description
  - Supports markdown checkboxes: `- [ ] item`
  - Supports numbered lists: `1. item`
  - Supports bullet points: `- item` (in AC section)
  - Looks for "Acceptance Criteria" section header
- **`parseIssueForTesting()`**: Converts Linear issue to ParsedIssue format
- **`shouldTriggerTests()`**: Determines if webhook should trigger tests
  - Checks for testing states: "ready for testing", "ready to test", "in testing", "qa", "testing"
  - Checks for "test" label

### 6. Queue Service (`src/services/queue.ts`)
- **TestQueue class**: Manages concurrent test execution
  - Default: 3 concurrent browser sessions (configurable via `MAX_CONCURRENT_TESTS`)
  - Prevents resource exhaustion from Chrome instances
  - Tracks running and queued tasks
  - Provides status and position information
- **Singleton instance**: `testQueue` exported for use across app

### 7. Storage Service (`src/services/storage.ts`)
- **`ensureDirectories()`**: Creates test-results/ and screenshots/ directories
- **`saveTestResult()`**: Saves test result as JSON file
  - Filename format: `{issueId}-{timestamp}.json`
- **`loadTestResult()`**: Loads test result from file
- **`listTestResults()`**: Lists all test result files
- **`getResultsForIssue()`**: Gets all results for a specific issue
- **`saveScreenshot()`**: Saves screenshot PNG file
  - Filename format: `{issueId}-{timestamp}-{index}.png`

### 8. Types (`src/types/index.ts`)
- **EnvSchema**: Environment variable validation schema
- **LinearWebhookPayloadSchema**: Webhook payload structure
- **TestResultSchema**: Test result structure
- **CriterionResultSchema**: Individual criterion result
- **ParsedIssue**: Internal issue representation

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `OPENAI_API_KEY` | OpenAI API key for Stagehand agent | Yes | - |
| `PORTAL_URL` | URL of application under test | Yes | - |
| `PORTAL_USERNAME` | Login username for portal | Yes | - |
| `PORTAL_PASSWORD` | Login password for portal | Yes | - |
| `LINEAR_WEBHOOK_SECRET` | Secret for webhook signature verification | Yes | - |
| `PORT` | Server port | No | 3000 |
| `MAX_CONCURRENT_TESTS` | Max parallel browser sessions | No | 3 |

## API Endpoints Summary

### Webhooks
- `POST /webhooks/linear` - Linear webhook receiver
- `GET /webhooks/health` - Health check

### API
- `GET /api/config` - Get configuration
- `POST /api/run-test` - Start manual test
- `GET /api/test-status/:testId` - Get test status
- `GET /api/test-screenshots/:testId` - Get test screenshots
- `GET /api/tests` - List all tests
- `GET /api/queue` - Get queue status

### Frontend
- `GET /` - Web UI for manual testing
- `GET /screenshots/:filename` - Serve screenshot files

## Test Execution Flow

1. **Webhook Trigger**: Linear sends webhook when issue state changes
2. **Signature Verification**: Server verifies webhook signature
3. **Payload Parsing**: Extracts issue data and acceptance criteria
4. **Trigger Check**: Validates if issue should trigger tests
5. **Queue Enqueue**: Adds test to execution queue
6. **Browser Launch**: Stagehand launches local Chrome (headless)
7. **Login**: AI agent logs into portal
8. **Criterion Testing**: For each AC:
   - Create agent with specific instructions
   - Execute verification task
   - Extract result using structured extraction
9. **Screenshot Capture**: Periodic screenshots (every 3s)
10. **Result Storage**: Save JSON result and screenshots
11. **Cleanup**: Close browser, update status

## Test Result Format

```json
{
  "issueId": "abc123",
  "issueIdentifier": "ENG-123",
  "issueTitle": "Add login feature",
  "issueUrl": "https://linear.app/...",
  "acceptanceCriteria": ["User can log in", "Dashboard loads"],
  "status": "passed" | "failed" | "error",
  "results": [
    {
      "criterion": "User can log in",
      "passed": true,
      "details": "Successfully logged in and verified dashboard loaded"
    }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z",
  "duration": 45000,
  "screenshots": ["screenshots/abc123-...-0.png"],
  "errorMessage": "..." // Only present if status is "error"
}
```

## Acceptance Criteria Formats

The system supports multiple formats for acceptance criteria:

1. **Markdown Checkboxes** (recommended):
   ```markdown
   ## Acceptance Criteria
   - [ ] User can log in with valid credentials
   - [ ] Dashboard shows user's name
   ```

2. **Numbered Lists**:
   ```markdown
   ## Acceptance Criteria
   1. User can log in with valid credentials
   2. Dashboard shows user's name
   ```

3. **Bullet Points** (in AC section):
   ```markdown
   ## Acceptance Criteria
   - User can log in with valid credentials
   - Dashboard shows user's name
   ```

## Web UI Features

The frontend (`public/index.html`) provides:
- **Test Configuration Panel**: View portal URL, enter acceptance criteria
- **Test Status Panel**: Real-time status updates, criterion-by-criterion results
- **Live Screenshot View**: Shows latest screenshot during test execution
- **Log Output**: Real-time log messages
- **Polling**: Auto-refreshes status and screenshots every 1.5-2 seconds

## Docker Configuration

### Dockerfile
- Multi-stage build (builder + production)
- Installs Chrome and dependencies in production stage
- Creates non-root user for security
- Health check configured
- Exposes port 3000

### Docker Compose
- Maps port from environment variable
- Mounts test-results and screenshots as volumes
- Sets shared memory to 2GB (required for Chrome)
- Health check with wget
- Restart policy: unless-stopped

## Concurrency Management

- **Default**: 3 concurrent browser sessions
- **Configurable**: Via `MAX_CONCURRENT_TESTS` env var
- **Queue System**: Tests are queued when at capacity
- **Status Tracking**: Real-time queue position and status
- **Prevention**: Duplicate test runs prevented for same issue

## Security Features

1. **Webhook Signature Verification**: HMAC SHA-256 with timing-safe comparison
2. **Raw Body Preservation**: Express middleware preserves raw body for signature verification
3. **Environment Validation**: Zod schema validates all required env vars at startup
4. **Non-root User**: Docker container runs as non-root user
5. **Error Handling**: Comprehensive error handling throughout

## Dependencies

### Production
- `@browserbasehq/stagehand`: ^2.0.0 - Browser automation framework
- `dotenv`: ^16.4.5 - Environment variable management
- `express`: ^4.21.0 - Web framework
- `zod`: ^3.23.8 - Schema validation

### Development
- `@types/express`: ^4.17.21 - Express type definitions
- `@types/node`: ^22.10.0 - Node.js type definitions
- `playwright`: ^1.58.1 - Browser automation (dependency)
- `tsx`: ^4.19.0 - TypeScript execution
- `typescript`: ^5.6.0 - TypeScript compiler

## Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run compiled JavaScript
- `npm run dev` - Run with hot reload (tsx watch)
- `npm run test:manual` - Run manual test script

## Deployment Considerations

### Requirements
- Node.js 18+
- Chrome installed locally (or in Docker)
- OpenAI API key
- Internet access for Linear webhooks

### Exposing to Internet
For Linear webhooks to reach the server:
- **Development**: ngrok, cloudflared tunnel
- **Production**: Railway, Fly.io, Render, DigitalOcean, etc.

### Cost
- **Browser sessions**: $0 (runs locally)
- **OpenAI API**: ~$0.01-0.10 per test (depends on complexity)

## Known Limitations

1. **Chrome Dependency**: Requires Chrome installed (or Docker with Chrome)
2. **Headless Mode**: Runs in headless mode (no visible browser)
3. **Sequential Criterion Testing**: Tests criteria one at a time (not parallel)
4. **Single Portal**: Configured for one portal URL at a time
5. **No Linear Integration**: Results not automatically posted back to Linear (TODO in code)

## Future Enhancements (from code comments)

- Post test results back to Linear as comments (mentioned in `webhooks.ts`)
- Support for multiple portals
- Parallel criterion testing
- Custom test configurations per issue

## File Locations

- **Test Results**: `test-results/{issueId}-{timestamp}.json`
- **Screenshots**: `screenshots/{issueId}-{timestamp}-{index}.png`
- **Environment Config**: `.env` (gitignored, use `.env.example` as template)
- **Build Output**: `dist/` (gitignored)

## Development Workflow

1. Copy `.env.example` to `.env` and configure
2. Run `npm install` to install dependencies
3. Run `npm run dev` for development with hot reload
4. Test manually via web UI at `http://localhost:3000`
5. Configure Linear webhook to point to your server
6. Move Linear issue to testing state to trigger automated tests

## Testing

- **Manual Testing**: Use web UI or `npm run test:manual`
- **Webhook Testing**: Use `scripts/test-webhook.sh` (if available)
- **Health Check**: `GET /webhooks/health` returns queue status

## Logging

Console logging includes prefixes:
- `[Webhook]` - Webhook-related logs
- `[API]` - API endpoint logs
- `[Stagehand]` - Browser automation logs
- `[Queue]` - Queue management logs
- `[Storage]` - File storage logs
- `[Linear]` - Linear service logs
