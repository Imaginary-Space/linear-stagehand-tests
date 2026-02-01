import "dotenv/config";
import path from "path";
import express from "express";
import { EnvSchema } from "./types/index.js";
import webhooksRouter from "./routes/webhooks.js";
import apiRouter from "./routes/api.js";
import { ensureDirectories } from "./services/storage.js";

// Prevent unhandled rejections from crashing the server
process.on("unhandledRejection", (reason, promise) => {
  console.error("[Server] Unhandled Rejection at:", promise, "reason:", reason);
  // Don't exit - keep server running
});

process.on("uncaughtException", (error) => {
  console.error("[Server] Uncaught Exception:", error);
  console.error("[Server] Stack trace:", error.stack);
  // Don't exit for non-fatal errors
  if (error.message?.includes("ECONNRESET") || error.message?.includes("EPIPE")) {
    return; // Ignore connection reset errors
  }
  // Log but don't exit - let the process try to recover
  console.error("[Server] Attempting to continue after exception...");
});

// Monitor process health
process.on("warning", (warning) => {
  console.warn("[Server] Process warning:", warning.name, warning.message);
});

// Log when process is about to exit
process.on("beforeExit", (code) => {
  console.log(`[Server] Process beforeExit with code: ${code}`);
});

process.on("exit", (code) => {
  console.log(`[Server] Process exit with code: ${code}`);
});

async function main() {
  // Validate environment variables
  const envResult = EnvSchema.safeParse(process.env);
  if (!envResult.success) {
    console.error("Invalid environment configuration:");
    console.error(envResult.error.format());
    process.exit(1);
  }

  const env = envResult.data;

  // Ensure required directories exist
  await ensureDirectories();

  // Create Express app
  const app = express();

  // Parse JSON bodies and preserve raw body for signature verification
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        // Store raw body for webhook signature verification
        (req as any).rawBody = buf.toString();
      },
    })
  );

  // Serve static files
  const publicPath = path.join(process.cwd(), "public");
  const screenshotsPath = path.join(process.cwd(), "screenshots");
  
  app.use(express.static(publicPath));
  app.use("/screenshots", express.static(screenshotsPath));

  // Mount routes
  app.use("/webhooks", webhooksRouter);
  app.use("/api", apiRouter);

  // Serve frontend for root
  app.get("/", (_req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  // Start server
  const port = parseInt(env.PORT, 10);
  const useBrowserbase = !!(env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID);
  const browserMode = useBrowserbase ? "Browserbase (cloud)" : "Local Chrome (headless)";
  
  const server = app.listen(port, () => {
    try {
      const portalUrlDisplay = env.PORTAL_URL ? env.PORTAL_URL.substring(0, 47).padEnd(49) : "Not configured".padEnd(49);
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  Linear Stagehand Tests                       ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running on port ${port.toString().padEnd(37)}║
║  UI:              http://localhost:${port}/                        ║
║  Webhook:         POST /webhooks/linear                       ║
║  Health:          GET /webhooks/health                        ║
╠═══════════════════════════════════════════════════════════════╣
║  Portal URL: ${portalUrlDisplay}║
║  Browser: ${browserMode.padEnd(51)}║
╚═══════════════════════════════════════════════════════════════╝
      `);
    } catch (error) {
      console.error("[Server] Error in startup callback:", error);
    }
  });

  // Handle server errors
  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error("[Server] Server error:", error);
    if (error.code === "EADDRINUSE") {
      console.error(`[Server] Port ${port} is already in use`);
      process.exit(1);
    }
  });

  // Keep the process alive
  server.on("close", () => {
    console.log("[Server] Server closed");
  });

  // Heartbeat to confirm server is running (every 5 minutes)
  const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    console.log(`[Server] Heartbeat - Memory: ${heapMB}MB heap, ${rssMB}MB RSS, Uptime: ${Math.round(process.uptime())}s`);
  }, HEARTBEAT_INTERVAL_MS);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
