import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { closeDatabase, connectToDatabase } from "./config/database.js";
import { errorHandler } from "./middlewares/error-handler.js";
import { fileRouter } from "./routes/file.routes.js";
import { ensureChunkIndexes } from "./services/chunk.service.js";
import { getStorage } from "./storage/index.js";

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use(helmet());

app.use(cors());

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

app.use("/api/files", fileRouter);

app.use(errorHandler);

async function start(): Promise<void> {
  // Fail fast on a bad STORAGE_PROVIDER or missing provider config.
  const storage = getStorage();
  console.log(`Using "${storage.name}" storage provider`);

  await connectToDatabase();
  await ensureChunkIndexes();

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
