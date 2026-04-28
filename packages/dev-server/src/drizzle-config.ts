// kumikoDrizzleConfig — Convention-Helper für drizzle.config.ts in App-
// Workspaces. Convention-driven Defaults statt Boilerplate-Copy:
//
//   import { kumikoDrizzleConfig } from "@kumiko/dev-server/drizzle-config";
//   export default kumikoDrizzleConfig();
//
// Default-Pfade:
//   schema:  "./drizzle/schema.ts"
//   out:     "./drizzle/migrations"
//   db url:  process.env[DATABASE_URL] (override via options)
//   dialect: "postgresql"
//   verbose + strict: true (drizzle-kit-Defaults für Production-Workflow)
//
// Apps mit untypischer Verzeichnis-Struktur können einzelne Werte
// überschreiben, der Rest bleibt Convention.

import { defineConfig } from "drizzle-kit";

export type KumikoDrizzleConfigOptions = {
  /** Pfad zum Schema-Barrel relativ zum App-Root. Default: "./drizzle/schema.ts". */
  readonly schemaPath?: string;
  /** Migrations-Out-Folder relativ zum App-Root. Default: "./drizzle/migrations". */
  readonly outDir?: string;
  /** Env-Var-Name für die Database-URL. Default: "DATABASE_URL". */
  readonly databaseUrlEnv?: string;
  /** Fallback-URL wenn die Env-Var leer ist (für lokale Dev-Setups).
   *  Default: postgres://kumiko:kumiko@localhost:15432/kumiko_dev (kumiko dev-stack). */
  readonly fallbackDatabaseUrl?: string;
};

export function kumikoDrizzleConfig(options: KumikoDrizzleConfigOptions = {}) {
  const envName = options.databaseUrlEnv ?? "DATABASE_URL";
  const fallback =
    options.fallbackDatabaseUrl ?? "postgres://kumiko:kumiko@localhost:15432/kumiko_dev";
  const url = process.env[envName] ?? fallback;
  return defineConfig({
    schema: options.schemaPath ?? "./drizzle/schema.ts",
    out: options.outDir ?? "./drizzle/migrations",
    dialect: "postgresql",
    dbCredentials: { url },
    verbose: true,
    strict: true,
  });
}
