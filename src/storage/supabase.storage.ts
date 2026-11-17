import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getS3, getS3Bucket } from "../config/s3.js";
import type { StorageProvider, StoredObject } from "./storage-provider.js";

// Supabase Storage through its S3-compatible API.
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = "supabase";
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor() {
    this.s3 = getS3();
    this.bucket = getS3Bucket();
  }

  async upload(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
    return { provider: this.name, key, bucket: this.bucket };
  }

  async delete(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
