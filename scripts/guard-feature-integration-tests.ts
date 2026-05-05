/**
 * Guard: Jedes Feature in packages/bundled-features/src/<name>/<name>-feature.ts
 * muss in mindestens einem *.integration.ts importiert werden. Sonst ist es
 * nie durchs volle Stack gelaufen — genau der "Feature gebaut, aber nicht
 * verdrahtet"-Fall aus CLAUDE.md.
 *
 * Kriterium: das Feature gilt als abgedeckt, wenn sein Basename (z.B.
 * "channel-email-feature") irgendwo als Import-Specifier in einem
 * *.integration.ts auftaucht. Die Datei wird dabei entweder direkt relativ
 * oder via Sub-Pfad importiert — beides matcht.
 *
 * Usage:
 *   yarn tsx scripts/guard-feature-integration-tests.ts
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const FEATURE_GLOB = "packages/bundled-features/src/**/*-feature.ts";
const INTEGRATION_GLOBS = [
  "packages/bundled-features/src/**/*.integration.ts",
  "packages/framework/src/**/*.integration.ts",
];

function collectFeatureBasenames(project: Project): Map<string, string> {
  project.addSourceFilesAtPaths(path.join(ROOT, FEATURE_GLOB));
  const features = new Map<string, string>();
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    if (!/-feature\.ts$/.test(filePath)) continue;
    if (/__tests__/.test(filePath)) continue;
    const base = path.basename(filePath, ".ts");
    features.set(base, path.relative(ROOT, filePath));
  }
  return features;
}

function collectImportedBasenames(project: Project): Set<string> {
  for (const glob of INTEGRATION_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }
  const imported = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    if (!/\.integration\.ts$/.test(sf.getFilePath())) continue;
    for (const imp of sf.getDescendantsOfKind(SyntaxKind.ImportDeclaration)) {
      const spec = imp.getModuleSpecifierValue();
      const base = path.basename(spec);
      imported.add(base);
    }
  }
  return imported;
}

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/bundled-features/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  const features = collectFeatureBasenames(project);
  const imported = collectImportedBasenames(project);

  const orphans: Array<{ name: string; file: string }> = [];
  for (const [base, file] of features) {
    if (!imported.has(base)) orphans.push({ name: base, file });
  }

  console.log(
    `Feature-Integration-Test Guard: ${features.size} Features gepruefft.`,
  );

  if (orphans.length === 0) {
    console.log("  Alle Features haben Integration-Test-Abdeckung.");
    return;
  }

  console.error(`\n  BLOCKED: ${orphans.length} Features ohne Integration-Test:\n`);
  for (const o of orphans) {
    console.error(`    ${o.file}`);
  }
  console.error(
    "\n  Jedes Feature braucht einen *.integration.ts, der es in setupTestStack({ features: [...] }) nutzt.\n",
  );
  process.exit(1);
}

main();
