import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | undefined;

// Supabase Storage exposes an S3-compatible API, so the AWS SDK works against it.
// Endpoint: https://<project-ref>.storage.supabase.co/storage/v1/s3
// Keys: Supabase dashboard > Storage > S3 Connection > Access keys.
export function getS3(): S3Client {
  if (client) return client;

  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set to use file storage.",
    );
  }

  client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // Supabase requires path-style URLs (endpoint/bucket/key).
    forcePathStyle: true,
  });
  return client;
}

export function getS3Bucket(): string {
  return process.env.S3_BUCKET || "documents";
}
