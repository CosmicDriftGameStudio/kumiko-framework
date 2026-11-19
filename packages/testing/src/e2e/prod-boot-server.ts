import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEmptyDatabase, databaseUrlOf, dropTestDb } from "../stack/db";

function builtEntryPath(name: string, path: string | undefined): string {
  if (path === undefined || !existsSync(resolve(path))) {
    throw new Error(`prod-boot: ${name} not found, run the app build first`);
  }
  return resolve(path);
}

const [serverEntry, cliEntry] = process.argv.slice(2);
const serverPath = builtEntryPath("serverEntry", serverEntry);
const cliPath = builtEntryPath("cliEntry", cliEntry);

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`prod-boot: ${name} is not set`);
  return value;
}

const baseUrl = requiredEnv("DATABASE_URL");
const port = requiredEnv("PORT");

const dbName = `kumiko_prod_boot_${port}`;
await dropTestDb(baseUrl, dbName);
await createEmptyDatabase(baseUrl, dbName);

const dbUrl = databaseUrlOf(baseUrl, dbName);
const bootEnv = {
  DATABASE_URL: dbUrl,
  SUBJECT_KEYS_DATABASE_URL: process.env["SUBJECT_KEYS_DATABASE_URL"] ?? dbUrl,
};

const result = spawnSync("bun", [cliPath, "schema", "apply"], {
  env: { ...process.env, ...bootEnv },
  stdio: "inherit",
});
if (result.status !== 0) throw new Error("prod-boot: schema apply failed");

Object.assign(process.env, bootEnv);
await import(pathToFileURL(serverPath).href);
