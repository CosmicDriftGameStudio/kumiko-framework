#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: CLI-Script, console ist Feature.
//
// kumiko schema check — Empfehlung 3 aus Sprint-9.8-Retro
// (luminous-watching-moler.md). Diff't APP_FEATURES (runtime, aus
// `src/run-config.ts`) gegen FEATURE_IMPORT_REGISTRY (statisch, aus
// `drizzle/generate.ts`). Catches:
//
//   1. Mount-without-registry: ein neues feature in APP_FEATURES ohne
//      Entry in FEATURE_IMPORT_REGISTRY. Resultiert in Schema-Drift:
//      Runtime mountet feature, Migration kennt seine Tabellen nicht.
//   2. Stale-registry: ein Entry in FEATURE_IMPORT_REGISTRY ohne
//      matching mount in APP_FEATURES. Dead-code; im Schema entsteht
//      eine Tabelle ohne Runtime-Konsument.
//
// Studio's 9.8-Drama: FEATURE_IMPORT_REGISTRY war 18 features hinter
// APP_FEATURES. Hätte mit diesem check eine Sekunde Lokal gefangen.
//
// Usage (aus dem app-workspace):
//   bunx kumiko-schema-check
//   # oder mit explicit pfaden:
//   bunx kumiko-schema-check --run-config src/run-config.ts --generate drizzle/generate.ts
//
// Exit 0 wenn alles in sync, exit 1 wenn drift.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type Args = {
  readonly runConfigPath: string;
  readonly generatePath: string;
};

function parseArgs(argv: readonly string[]): Args {
  const cwd = process.cwd();
  let runConfigPath = resolve(cwd, "src/run-config.ts");
  let generatePath = resolve(cwd, "drizzle/generate.ts");
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
  return { runConfigPath, generatePath };
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
  };
  if (!mod.APP_FEATURES) {
    throw new Error(
      `kumiko-schema-check: ${runConfigPath} hat kein 'APP_FEATURES' export. ` +
        `Convention: 'export const APP_FEATURES = [...] as const'.`,
    );
  }
  // composeFeatures auto-prepends config + user + tenant + auth-email-
  // password im auth-mode. Wenn HAS_AUTH=true (oder default), die 4
  // implicit-mounted features auch in die Set tun damit der Diff nicht
  // false-positive "auth-email-password is mounted but no registry-entry"
  // produziert. Studio/use-all-bundled HAS_AUTH=true ist convention.
  const set = new Set<string>();
  for (const f of mod.APP_FEATURES) {
    set.add(f.name);
  }
  if (mod.HAS_AUTH ?? true) {
    set.add("config");
    set.add("user");
    set.add("tenant");
    set.add("auth-email-password");
  }
  return set;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

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

await main();
