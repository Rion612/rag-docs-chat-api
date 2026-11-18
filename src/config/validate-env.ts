import { z } from "zod";

type Env = Record<string, string>;

const optionalString = z.string().optional();

const optionalInt = (min: number, max: number) =>
  z.coerce
    .number({ error: "must be a number" })
    .int("must be a whole number")
    .min(min, `must be at least ${min}`)
    .max(max, `must be at most ${max}`)
    .optional();

/** Rules for each variable on its own. */
const envSchema = z.object({
  PORT: optionalInt(1, 65_535),
  NODE_ENV: z
    .enum(["development", "production", "test"], {
      error: "must be development, production, or test",
    })
    .optional(),

  // Sessions and access
  SESSION_SECRET: z
    .string({
      error:
        "is required (generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\")",
    })
    .min(32, "must be at least 32 characters"),
  SESSION_TTL_DAYS: optionalInt(1, 365),
  CORS_ORIGINS: z
    .string()
    .refine(
      (value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean)
          .every((origin) => /^https?:\/\/[^/\s]+$/.test(origin)),
      "must be comma-separated origins like https://app.example.com (no paths or trailing slashes)",
    )
    .optional(),
  TRUST_PROXY: optionalInt(0, 10),
  MAX_FILES_PER_SESSION: optionalInt(1, 10_000),

  // MongoDB
  MONGODB_URI: z
    .string()
    .regex(
      /^mongodb(\+srv)?:\/\//,
      "must start with mongodb:// or mongodb+srv://",
    )
    .optional(),
  MONGO_HOST: optionalString,
  MONGO_PORT: optionalInt(1, 65_535),
  MONGO_USER: optionalString,
  MONGO_PASSWORD: optionalString,
  MONGO_DB_NAME: optionalString,

  // Gemini
  GEMINI_API_KEY: z.string({
    error: "is required (create one at https://aistudio.google.com/apikey)",
  }),
  GEMINI_CHAT_MODEL: optionalString,
  GEMINI_EMBEDDING_MODEL: optionalString,
  GEMINI_EMBEDDING_DIMENSIONS: optionalInt(128, 3072),

  // Chunking
  CHUNK_SIZE: optionalInt(100, 100_000),
  CHUNK_OVERLAP: optionalInt(0, 100_000),

  // Storage
  STORAGE_PROVIDER: z
    .enum(["local", "supabase"], { error: "must be local or supabase" })
    .optional(),
  LOCAL_STORAGE_DIR: optionalString,
  S3_ENDPOINT: optionalString,
  S3_REGION: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_BUCKET: optionalString,
});

/**
 * Rules that depend on more than one variable. Kept outside the schema so
 * they are reported even when some single-variable rule also fails.
 */
function crossFieldProblems(env: Env): [string, string][] {
  const problems: [string, string][] = [];

  if (env.NODE_ENV === "production" && !env.CORS_ORIGINS) {
    problems.push([
      "CORS_ORIGINS",
      "is required in production (your frontend's origin, e.g. https://app.example.com)",
    ]);
  }

  if (!env.MONGODB_URI && !!env.MONGO_USER !== !!env.MONGO_PASSWORD) {
    problems.push([
      env.MONGO_USER ? "MONGO_PASSWORD" : "MONGO_USER",
      "MONGO_USER and MONGO_PASSWORD must be set together",
    ]);
  }

  const chunkSize = Number(env.CHUNK_SIZE ?? 1000);
  const chunkOverlap = Number(env.CHUNK_OVERLAP ?? 200);
  if (
    Number.isFinite(chunkSize) &&
    Number.isFinite(chunkOverlap) &&
    chunkOverlap >= chunkSize
  ) {
    problems.push(["CHUNK_OVERLAP", "must be smaller than CHUNK_SIZE"]);
  }

  if (env.STORAGE_PROVIDER === "supabase") {
    for (const key of [
      "S3_ENDPOINT",
      "S3_REGION",
      "S3_ACCESS_KEY_ID",
      "S3_SECRET_ACCESS_KEY",
    ]) {
      if (!env[key]) {
        problems.push([key, "is required when STORAGE_PROVIDER=supabase"]);
      }
    }

    const endpoint = env.S3_ENDPOINT;
    if (endpoint && /project[_-]ref/i.test(endpoint)) {
      problems.push([
        "S3_ENDPOINT",
        "still contains the project-ref placeholder; copy the endpoint from Supabase > Storage > S3 Connection",
      ]);
    } else if (
      endpoint &&
      !/^https:\/\/.+\/storage\/v1\/s3\/?$/.test(endpoint)
    ) {
      problems.push([
        "S3_ENDPOINT",
        "must look like https://<project-ref>.storage.supabase.co/storage/v1/s3",
      ]);
    }
  }

  return problems;
}

/**
 * Checks every environment variable the app uses and exits with a list of
 * all problems if any are found. Messages never include the values, so
 * secrets are not printed. Call once at startup, after .env is loaded.
 */
export function validateEnv(): void {
  // Treat blank and whitespace-only values (e.g. `MONGODB_URI=`) as not set.
  const env: Env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const trimmed = value?.trim();
    if (trimmed) env[key] = trimmed;
  }

  const result = envSchema.safeParse(env);
  const problems: [string, string][] = [
    ...(result.success
      ? []
      : result.error.issues.map((issue): [string, string] => [
          issue.path.join("."),
          issue.message,
        ])),
    ...crossFieldProblems(env),
  ];
  if (problems.length === 0) return;

  console.error(
    "Invalid environment configuration. Fix these in your .env file:\n" +
      problems.map(([key, message]) => `  - ${key}: ${message}`).join("\n"),
  );
  process.exit(1);
}
