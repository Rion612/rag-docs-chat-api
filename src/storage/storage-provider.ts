export const STORAGE_PROVIDERS = ["local", "supabase"] as const;

export type StorageProviderName = (typeof STORAGE_PROVIDERS)[number];

export interface StoredObject {
  provider: StorageProviderName;
  /** Object key, e.g. "pdfs/<id>.pdf". */
  key: string;
  /** Bucket name, for bucket-based providers only. */
  bucket?: string;
}

export interface StorageProvider {
  readonly name: StorageProviderName;
  upload(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
