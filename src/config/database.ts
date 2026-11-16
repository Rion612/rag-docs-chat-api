import { MongoClient, type Db } from "mongodb";

let client: MongoClient | undefined;
let db: Db | undefined;

function buildMongoUri(): string {
  if (process.env.MONGODB_URI) return process.env.MONGODB_URI;

  const host = process.env.MONGO_HOST || "localhost";
  const port = process.env.MONGO_PORT || "27017";
  const user = process.env.MONGO_USER;
  const password = process.env.MONGO_PASSWORD;

  // directConnection is required for the single-node mongodb-atlas-local container.
  if (user && password) {
    const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;
    return `mongodb://${credentials}@${host}:${port}/?directConnection=true&authSource=admin`;
  }
  return `mongodb://${host}:${port}/?directConnection=true`;
}

export async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const dbName = process.env.MONGO_DB_NAME || "rag_docs_chat";

  client = new MongoClient(buildMongoUri(), {
    appName: "rag-docs-chat-api",
    serverSelectionTimeoutMS: 5000,
  });

  await client.connect();
  db = client.db(dbName);
  await db.command({ ping: 1 });

  console.log(`Connected to MongoDB database "${dbName}"`);
  return db;
}

export function getDb(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectToDatabase() first.");
  }
  return db;
}

export async function closeDatabase(): Promise<void> {
  if (!client) return;
  await client.close();
  client = undefined;
  db = undefined;
  console.log("MongoDB connection closed");
}
