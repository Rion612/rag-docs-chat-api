import { LocalStorageProvider } from "./local.storage.js";
import {
  STORAGE_PROVIDERS,
  type StorageProvider,
  type StorageProviderName,
} from "./storage-provider.js";
import { SupabaseStorageProvider } from "./supabase.storage.js";

export type { StorageProvider, StoredObject } from "./storage-provider.js";

let provider: StorageProvider | undefined;

function isProviderName(value: string): value is StorageProviderName {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value);
}

/** Returns the provider selected by STORAGE_PROVIDER (default: "local"). */
export function getStorage(): StorageProvider {
  if (provider) return provider;

  const name = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
  if (!isProviderName(name)) {
    throw new Error(
      `Unknown STORAGE_PROVIDER "${name}". Use one of: ${STORAGE_PROVIDERS.join(", ")}.`,
    );
  }

  switch (name) {
    case "local":
      provider = new LocalStorageProvider();
      break;
    case "supabase":
      provider = new SupabaseStorageProvider();
      break;
  }
  return provider;
}
