#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI script, console output is the feature.
//
// kumiko schema check: diffs APP_FEATURES (runtime, from `src/run-config.ts`)
// against FEATURE_IMPORT_REGISTRY (static, from `drizzle/generate.ts`).
// Catches:
//
//   1. Mount without registry: a feature in APP_FEATURES with no entry in
//      FEATURE_IMPORT_REGISTRY. Causes schema drift: the runtime mounts the
//      feature but the migration does not know its tables.
//   2. Stale registry: an entry in FEATURE_IMPORT_REGISTRY with no matching
//      mount in APP_FEATURES. Dead code; the schema gets a table without a
//      runtime consumer.
//
// Exit 0 when in sync, exit 1 on drift.
//
// Scaffold layout (kumiko/schema.ts, no generate.ts): there is no static
// registry that could drift, so the check says so and points to
// `kumiko-schema validate`.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  implicitAuthModeFeatureNames,
  resolveGeneratePath,
  usesDerivedSchemaLayout,
} from "@cosmicdrift/kumiko-dev-server/cli";

type Args = {
  readonly runConfigPath: string;
  readonly generatePath: string;
  readonly generateExplicit: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const cwd = process.cwd();
  let runConfigPath = resolve(cwd, "src/run-config.ts");
  let generatePath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--run-config" && value) {
      runConfigPath = resolve(cwd, value);
      i++;
    } else if (flag === "--generate" && value) {
      generatePath = resolve(cwd, value);
      i++;
    }
  }
  return {
    runConfigPath,
    generatePath: generatePath ?? resolveGeneratePath(cwd),
    generateExplicit: generatePath !== undefined,
  };
}

function readRegistryFeatures(generateSrc: string): Set<string> {
  // Match object-keys mit Discriminator `kind: "factory" | "named"`.
  // Quoted ("billing-foundation") oder unquoted (config, user) — beides
  // ist gültig in JS. Pattern aus use-all-bundled/scripts/check-coverage.ts
  // dupliziert hier weil per-app-CLI nicht von sample-script lesen darf.
  const re = /(?:"([a-z][a-z0-9-]*)"|([a-z][a-z0-9]*)):\s*\{\s*kind:\s*"(factory|named)"/g;
  const out = new Set<string>();
  for (const m of generateSrc.matchAll(re)) {
    const name = m[1] ?? m[2];
    if (name) out.add(name);
  }
  return out;
}

async function readMountedFeatures(runConfigPath: string): Promise<Set<string>> {
  const mod = (await import(runConfigPath)) as {
    APP_FEATURES?: ReadonlyArray<{ name: string }>;
    HAS_AUTH?: boolean;
    HAS_SIGNUP?: boolean;
  };
  if (!mod.APP_FEATURES) {
    throw new Error(
      `kumiko-schema-check: ${runConfigPath} hat kein 'APP_FEATURES' export. ` +
        `Convention: 'export const APP_FEATURES = [...] as const'.`,
    );
  }
  const set = new Set<string>();
  for (const f of mod.APP_FEATURES) {
    set.add(f.name);
  }
  // HAS_AUTH defaults to true (Studio/use-all-bundled convention). When set,
  // include the implicit auth-mode features so the diff doesn't false-positive
  // "auth-email-password is mounted but no registry-entry".
  if (mod.HAS_AUTH ?? true) {
    for (const name of implicitAuthModeFeatureNames()) set.add(name);
  }
  // auth-self-registration is only prepended when authOptions.signup is set
  // (composeFeatures) — opt-in via HAS_SIGNUP so apps without signup don't
  // get a stale-registry false positive (#1521).
  if (mod.HAS_SIGNUP === true) {
    set.add("auth-self-registration");
  }
  return set;
}

const USAGE = "Usage: kumiko-schema-check [--run-config <path>] [--generate <path>]";

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg === "--help" || arg === "-h")) {
    console.log(USAGE);
    process.exit(0);
  }
  const args = parseArgs(process.argv.slice(2));

  if (!args.generateExplicit && usesDerivedSchemaLayout(process.cwd())) {
    console.log(
      "✓ kumiko/schema.ts derives ENTITY_METAS from APP_FEATURES, there is no import registry that could drift. Use `bun kumiko-schema validate` to check migrations against the features.",
    );
    process.exit(0);
  }

  if (!existsSync(args.runConfigPath)) {
    console.error(`✗ run-config not found: ${args.runConfigPath}`);
    process.exit(1);
  }
  if (!existsSync(args.generatePath)) {
    console.error(`✗ generate not found: ${args.generatePath}`);
    process.exit(1);
  }

  const registry = readRegistryFeatures(readFileSync(args.generatePath, "utf-8"));
  const mounted = await readMountedFeatures(args.runConfigPath);

  // Mounted but not in registry → schema-drift (runtime ↔ migration mismatch).
  const mountedWithoutEntry: string[] = [];
  for (const name of mounted) {
    if (!registry.has(name)) mountedWithoutEntry.push(name);
  }
  // In registry but not mounted → stale entry (dead schema-mapping).
  const staleEntries: string[] = [];
  for (const name of registry) {
    if (!mounted.has(name)) staleEntries.push(name);
  }

  let ok = true;

  if (mountedWithoutEntry.length > 0) {
    console.error(
      `\n✗ ${mountedWithoutEntry.length} feature(s) mounted in APP_FEATURES but NOT in FEATURE_IMPORT_REGISTRY:`,
    );
    for (const name of mountedWithoutEntry.sort()) {
      console.error(`   - ${name}`);
    }
    console.error(
      "\n  Action: in drizzle/generate.ts FEATURE_IMPORT_REGISTRY den Eintrag ergänzen,",
    );
    console.error("  damit Schema-Generator + Migration die feature-Tabellen kennt.");
    ok = false;
  }

  if (staleEntries.length > 0) {
    console.error(
      `\n✗ ${staleEntries.length} stale FEATURE_IMPORT_REGISTRY entry/entries (kein matching mount):`,
    );
    for (const name of staleEntries.sort()) {
      console.error(`   - ${name}`);
    }
    console.error("\n  Action: entry aus drizzle/generate.ts FEATURE_IMPORT_REGISTRY entfernen,");
    console.error("  oder das feature in src/run-config.ts mounten.");
    ok = false;
  }

  if (ok) {
    console.log(
      `✓ schema check: ${mounted.size} mounted ↔ ${registry.size} registry entries, no drift`,
    );
    process.exit(0);
  } else {
    process.exit(1);
  }
}

// Only run when executed as a CLI, not when imported (e.g. from tests that
// exercise the exported pure helpers).
if (import.meta.main) {
  await main();
}
