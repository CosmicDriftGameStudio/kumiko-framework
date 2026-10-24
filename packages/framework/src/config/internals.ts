import type { AppPortRole } from "./index.ts";

export type AppClientConfig = {
  /** Client bundle entry files, relative to the app root (e.g. "src/client.tsx"). */
  readonly entries: readonly string[];
};

export type AppPortEntry = { readonly role: AppPortRole; readonly port: number };
