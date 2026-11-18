import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { closeDatabase, connectToDatabase } from "./config/database.js";
import { validateEnv } from "./config/validate-env.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { apiLimiter } from "./middlewares/rate-limit.js";
import { requireSession } from "./middlewares/require-session.js";
import { chatRouter } from "./routes/chat.routes.js";
import { fileRouter } from "./routes/file.routes.js";
import { sessionRouter } from "./routes/session.routes.js";
import { getStorage } from "./storage/index.js";

const PORT = Number(process.env.PORT) || 3000;

const app = express();

// Behind a reverse proxy or load balancer, set TRUST_PROXY to the number of
// proxies so rate limits see the client's real IP, not the proxy's.
app.set("trust proxy", Number(process.env.TRUST_PROXY || 0));

app.use(helmet());

// Only the listed frontend origins may call the API from a browser.
// Unset means any origin, which validateEnv allows only outside production.
const corsOrigins = process.env.CORS_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: corsOrigins?.length ? corsOrigins : true,
    allowedHeaders: ["Authorization", "Content-Type"],
    exposedHeaders: ["RateLimit", "RateLimit-Policy", "Retry-After"],
  }),
);

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

// JSON bodies (chat questions are small; uploads use multipart, not JSON).
app.use(express.json({ limit: "100kb" }));

app.use("/api/sessions", sessionRouter);
app.use("/api/files", requireSession, apiLimiter, fileRouter);
app.use("/api/chat", requireSession, apiLimiter, chatRouter);

app.use(errorHandler);

async function start(): Promise<void> {
  // Exit with a clear list of problems if any setting is missing or invalid.
  validateEnv();

  // Fail fast on a bad STORAGE_PROVIDER or missing provider config.
  const storage = getStorage();
  console.log(`Using "${storage.name}" storage provider`);

  // Indexes are created by `npm run db:setup`, not on startup.
  await connectToDatabase();

  const server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start().catch((error: unknown) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
