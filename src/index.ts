import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { closeDatabase, connectToDatabase } from "./config/database.js";

const PORT = Number(process.env.PORT) || 3000;

const app = express();

app.use(helmet());

app.use(cors());

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

async function start(): Promise<void> {
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
