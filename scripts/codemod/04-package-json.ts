#!/usr/bin/env bun
// Codemod 04: package.json migrations
//
// Transforms:
//   scripts:
//     "vitest"         → "bun test"
//     "vitest run"     → "bun test"
//     "vitest --watch" → "bun test --watch"
//     "yarn run -T playwright" → "bunx --bun playwright"
//     "yarn workspaces foreach -A" → "bun --filter='*'"
//     "node X.ts"      → "bun X.ts"  (nur eindeutige Patterns)
//
//   dependenciesMeta:
//     entferne yarn-spezifisch, ergänze trustedDependencies: [] falls nicht vorhanden
//
//   resolutions:
//     bleiben unverändert (bun supportet "resolutions" + "overrides")
//
//   packageManager:
//     "yarn@4.x.x" → "bun@1.3.14"
//
//   link:./path Protocol → file:./path
//
//   devDependencies:
//     entferne "vitest", "@vitest/coverage-v8" (manuell — codemod warnt nur)

import { Glob } from "bun";
import { resolve, relative } from "node:path";

const PROJECT_ROOT = process.argv[2] ?? process.cwd();
const BUN_VERSION = process.argv[3] ?? "1.3.14";

const SCRIPT_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bvitest run --config\s+(\S+)/g, "bun test --config $1"], // Hinweis: bunfig.toml hat keine --config-Flag-Variant, manual nötig
  [/\bvitest run\b/g, "bun test"],
  [/\bvitest --watch\b/g, "bun test --watch"],
  [/(?<![\w-])vitest\b(?!\.)/g, "bun test"], // standalone "vitest"
  [/\byarn run -T playwright/g, "bunx --bun playwright"],
  [/\byarn workspaces foreach -A\b/g, "bun --filter='*'"],
  [/\byarn run\b/g, "bun run"],
  [/\bnpx playwright/g, "bunx --bun playwright"],
];

async function transformPackageJson(path: string): Promise<{ changed: boolean; warnings: string[] }> {
  const text = await Bun.file(path).text();
  const pkg = JSON.parse(text) as Record<string, unknown>;
  const warnings: string[] = [];
  let changed = false;

  // scripts
  if (pkg.scripts && typeof pkg.scripts === "object") {
    const scripts = pkg.scripts as Record<string, string>;
    for (const [name, cmd] of Object.entries(scripts)) {
      let next = cmd;
      for (const [pattern, replacement] of SCRIPT_REPLACEMENTS) {
        next = next.replace(pattern, replacement);
      }
      if (next !== cmd) {
        scripts[name] = next;
        changed = true;
      }
    }
  }

  // packageManager
  if (typeof pkg.packageManager === "string" && pkg.packageManager.startsWith("yarn@")) {
    pkg.packageManager = `bun@${BUN_VERSION}`;
    changed = true;
  }

  // dependenciesMeta → trustedDependencies
  if (pkg.dependenciesMeta && typeof pkg.dependenciesMeta === "object") {
    const meta = pkg.dependenciesMeta as Record<string, { built?: boolean }>;
    const trusted = new Set<string>();
    for (const [name, val] of Object.entries(meta)) {
      // Yarn's `built: false` → don't auto-build
      // Bun's `trustedDependencies` = whitelist (everything else is "not trusted")
      // → leerer Whitelist heißt "kein native-build außer prebuilds"
      if (val.built === false) {
        // skip — packages mit `built: false` werden auch von bun nicht gebaut wenn nicht in trustedDependencies
      } else if (val.built === true) {
        trusted.add(name.replace(/@\d.*$/, "")); // strip version pin from key
      }
    }
    delete pkg.dependenciesMeta;
    if (trusted.size > 0) {
      pkg.trustedDependencies = Array.from(trusted).sort();
    } else if (!pkg.trustedDependencies) {
      pkg.trustedDependencies = [];
    }
    changed = true;
  }

  // link: → file:
  for (const depField of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const deps = pkg[depField] as Record<string, string> | undefined;
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.startsWith("link:./") || spec.startsWith("link:../")) {
        deps[name] = spec.replace(/^link:/, "file:");
        changed = true;
      }
    }
  }

  // vitest in devDependencies — nur warnen, manuell entfernen
  const devDeps = pkg.devDependencies as Record<string, string> | undefined;
  if (devDeps && (devDeps.vitest || devDeps["@vitest/coverage-v8"])) {
    warnings.push(`${relative(PROJECT_ROOT, path)}: vitest devDep present — remove manually after migration`);
  }

  if (changed) {
    await Bun.write(path, JSON.stringify(pkg, null, "\t") + "\n");
  }

  return { changed, warnings };
}

async function main(): Promise<void> {
  console.log(`[codemod 04-package-json] project: ${PROJECT_ROOT}`);
  console.log(`[codemod 04-package-json] target bun version: ${BUN_VERSION}`);

  const glob = new Glob("**/package.json");
  const EXCLUDE_PATTERNS = ["/node_modules/", "/dist/", "/build/", "/.next/"];

  let touched = 0;
  const allWarnings: string[] = [];

  for await (const file of glob.scan({ cwd: PROJECT_ROOT, dot: false })) {
    const abs = resolve(PROJECT_ROOT, file);
    if (EXCLUDE_PATTERNS.some((p) => abs.includes(p))) continue;

    try {
      const { changed, warnings } = await transformPackageJson(abs);
      if (changed) touched++;
      allWarnings.push(...warnings);
    } catch (e) {
      console.error(`  FAILED: ${file}: ${String(e).slice(0, 120)}`);
    }
  }

  console.log(`[codemod 04-package-json] transformed ${touched} files`);

  if (allWarnings.length) {
    console.log(`[codemod 04-package-json] warnings:`);
    for (const w of allWarnings) console.log(`  ${w}`);
  }
}

await main();
