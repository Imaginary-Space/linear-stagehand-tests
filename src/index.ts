import "dotenv/config";
import path from "path";
import express from "express";
import { EnvSchema } from "./types/index.js";
import webhooksRouter from "./routes/webhooks.js";
import apiRouter from "./routes/api.js";
import { ensureDirectories } from "./services/storage.js";

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
  
  app.listen(port, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                  Linear Stagehand Tests                       ║
╠═══════════════════════════════════════════════════════════════╣
║  Server running on port ${port.toString().padEnd(37)}║
║  UI:              http://localhost:${port}/                        ║
║  Webhook:         POST /webhooks/linear                       ║
║  Health:          GET /webhooks/health                        ║
╠═══════════════════════════════════════════════════════════════╣
║  Portal URL: ${env.PORTAL_URL.substring(0, 47).padEnd(49)}║
║  Browser: ${browserMode.padEnd(51)}║
╚═══════════════════════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
