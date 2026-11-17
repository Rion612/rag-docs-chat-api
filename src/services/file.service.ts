import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { ObjectId } from "mongodb";
import { getDb } from "../config/database.js";
import { getS3, getS3Bucket } from "../config/s3.js";

export interface FileDocument {
  _id: ObjectId;
  originalName: string;
  mimeType: string;
  size: number;
  bucket: string;
  storagePath: string;
  createdAt: Date;
  updatedAt: Date;
}

function filesCollection() {
  return getDb().collection<FileDocument>("files");
}

export async function savePdf(
  file: Express.Multer.File,
): Promise<FileDocument> {
  const id = new ObjectId();
  const bucket = getS3Bucket();
  const storagePath = `pdfs/${id.toHexString()}.pdf`;
  const s3 = getS3();

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      Body: file.buffer,
      ContentType: "application/pdf",
      ContentLength: file.size,
    }),
  );

  const now = new Date();
  const doc: FileDocument = {
    _id: id,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    bucket,
    storagePath,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await filesCollection().insertOne(doc);
  } catch (error) {
    // Don't leave an orphaned object in storage if the metadata write fails.
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: storagePath }))
      .catch(() => undefined);
    throw error;
  }

  return doc;
}
