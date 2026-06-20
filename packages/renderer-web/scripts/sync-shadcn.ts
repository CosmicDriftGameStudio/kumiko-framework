#!/usr/bin/env bun
// Vendort echten shadcn-Source nach src/ui/ — die EINZIGE Quelle der ui/-Dateien.
// src/ui/ wird NIE von Hand editiert; ein Update ist `bun scripts/sync-shadcn.ts <comp>`.
// Die Registry serviert den vollen Source als JSON (verifiziert 2026-06-20):
// https://ui.shadcn.com/r/styles/new-york/<comp>.json
//   → { files: [{ path, content }], registryDependencies, dependencies }
// Wir folgen registryDependencies rekursiv, schreiben files[].content flach nach
// src/ui/<basename> und biegen die @/-Aliase auf unsere Struktur um.
//
// Aufruf: bun scripts/sync-shadcn.ts sidebar breadcrumb badge table ...

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

// new-york-v4 = Tailwind-v4-native Quelle (arbitrary-value var-Syntax
// `w-(--sidebar-width)` statt v3-`w-[--sidebar-width]`, data-slot-Pattern,
// unified `radix-ui`-Package). Die v3-`new-york`-Variante bricht unter
// Tailwind v4 (Sidebar-Breite kollabiert auf 0).
const STYLE = "new-york-v4";
const REGISTRY = `https://ui.shadcn.com/r/styles/${STYLE}`;
const UI_DIR = resolve(import.meta.dirname, "../src/ui");

type RegistryItem = {
  readonly files?: ReadonlyArray<{ readonly path: string; readonly content: string }>;
  readonly registryDependencies?: readonly string[];
  readonly dependencies?: readonly string[];
};

// Biegt shadcns @/-Aliase auf unsere Repo-Struktur:
//   @/lib/utils          → ../lib/cn   (exportiert cn)
//   @/components/ui/<x>   → ./<x>       (Nachbar in src/ui/)
//   @/hooks/<x>          → ./<x>       (Hooks liegen flach in src/ui/)
//   @/registry/<style>/ui/<x> → ./<x>
function rewriteImports(content: string): string {
  return content
    .replaceAll(/@\/registry\/[^/]+\/lib\/utils/g, "../lib/cn")
    .replaceAll(/@\/registry\/[^/]+\/(ui|hooks)\//g, "./")
    .replaceAll("@/lib/utils", "../lib/cn")
    .replaceAll("@/components/ui/", "./")
    .replaceAll("@/hooks/", "./");
}

const npmDeps = new Set<string>();
const visited = new Set<string>();

async function sync(name: string): Promise<void> {
  if (visited.has(name)) return;
  visited.add(name);

  const res = await fetch(`${REGISTRY}/${name}.json`);
  if (!res.ok) throw new Error(`registry fetch ${name}: ${res.status} ${res.statusText}`);
  const item = (await res.json()) as RegistryItem;

  for (const dep of item.dependencies ?? []) npmDeps.add(dep);

  for (const file of item.files ?? []) {
    const out = resolve(UI_DIR, basename(file.path));
    // @ts-nocheck-Header: src/ui ist vendored upstream-Code (wie eine
    // Dependency), den wir nicht selbst typchecken — shadcn-v4 + radix-ui-Slot
    // produzieren unter React-19-strict einen `style`-Typkonflikt
    // (`--radix-*`-Index-Signature), der zur Laufzeit irrelevant ist. Header
    // deterministisch beim Sync gesetzt, damit src/ui pristine-regenerierbar
    // bleibt (kein Hand-Edit). biome ignoriert src/ui ohnehin.
    const header = "// @ts-nocheck — vendored shadcn, regenerate via scripts/sync-shadcn.ts\n";
    writeFileSync(out, header + rewriteImports(file.content));
    console.log(`  ui/${basename(file.path)}`);
  }

  for (const dep of item.registryDependencies ?? []) await sync(dep);
}

const components = process.argv.slice(2);
if (components.length === 0) {
  console.error("usage: bun scripts/sync-shadcn.ts <component> [<component> ...]");
  process.exit(1);
}

mkdirSync(UI_DIR, { recursive: true });
for (const c of components) {
  console.log(`sync ${c}:`);
  await sync(c);
}

console.log("\nnpm deps referenced (ensure present in package.json):");
for (const d of [...npmDeps].sort()) console.log(`  ${d}`);
