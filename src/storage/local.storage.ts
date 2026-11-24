import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageProvider, StoredObject } from "./storage-provider.js";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly rootDir: string;

  constructor() {
    // Relative paths resolve from the directory the server is started in (the project root).
    this.rootDir = path.resolve(process.env.LOCAL_STORAGE_DIR || "uploads");
  }

  private resolve(key: string): string {
    const filePath = path.resolve(this.rootDir, key);
    if (!filePath.startsWith(this.rootDir + path.sep)) {
      throw new Error(`Invalid storage key: ${key}`);
    }
    return filePath;
  }

  async upload(key: string, body: Buffer): Promise<StoredObject> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    // "wx" fails instead of overwriting if the file already exists.
    await writeFile(filePath, body, { flag: "wx" });
    return { provider: this.name, key };
  }

  async download(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
