#!/usr/bin/env bun
// security-baseline-stack — mounts crypto-shredding, rate-limiting and audit next to sessions:
//   export const APP_FEATURES = [createSessionsFeature(), ...] as const;
//   -> [createSessionsFeature(), ...composeSecurityStack({ includeSessions: false }), ...]
// Only src/run-config.ts whose APP_FEATURES is an array literal with a createSessionsFeature()
// entry and none of the security-baseline features. crypto-shredding aborts the boot unless
// bin/main.ts hands a kmsMode, kms, allowPlaintextPii or kmsWiring to runProdApp, and rate-limiting
// aborts it with `rateLimit: false`, so an app whose bin/main.ts does either is reported as manual
// and left alone.
//
// Usage:
//   bun scripts/codemod/security-baseline-stack.ts <targetDir...> [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1
// while any rewritable or manual site is left; --dry-run only reports.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Node, Project, type SourceFile } from "ts-morph";
import {
  applyEdits,
  type CodemodResult,
  runCodemodCli,
  type SiteLists,
  type TextEdit,
} from "./codemod-support.ts";

const COMPOSE_SPECIFIER = "@cosmicdrift/kumiko-dev-server/compose-stacks";
const COMPOSE_IMPORT = `import { composeSecurityStack } from "${COMPOSE_SPECIFIER}";`;
const SECURITY_SPREAD = "...composeSecurityStack({ includeSessions: false })";

const CHEAP_PREFILTER = /createSessionsFeature/;
const ALREADY_MOUNTED =
  /composeSecurityStack|createCryptoShreddingFeature|createRateLimitingFeature|createAuditFeature/;
// The options the kmsMode boot requirement accepts, as property, shorthand or the scaffold's spread.
const KMS_HANDED_TO_RUN_PROD_APP =
  /\.\.\.\s*kmsWiring\b|\b(?:kmsMode|kms|allowPlaintextPii)\s*:|[{,]\s*(?:kmsMode|kms|allowPlaintextPii)\s*[,}]/;
const RATE_LIMIT_DISABLED = /\brateLimit\s*:\s*false\b/;

function isRunConfig(filePath: string): boolean {
  return basename(filePath) === "run-config.ts" && basename(dirname(filePath)) === "src";
}

// Why the app cannot take composeSecurityStack as is, or undefined when its bin/main.ts boots with it.
function bootBlockerInMain(runConfigPath: string): string | undefined {
  const mainPath = join(dirname(runConfigPath), "..", "bin", "main.ts");
  const main = existsSync(mainPath) ? readFileSync(mainPath, "utf8") : "";
  if (!KMS_HANDED_TO_RUN_PROD_APP.test(main)) {
    return "bin/main.ts passes no kmsMode, kms, allowPlaintextPii or kmsWiring to runProdApp, so crypto-shredding would abort the boot; wire the KMS first, then add composeSecurityStack({ includeSessions: false }) after createSessionsFeature()";
  }
  if (RATE_LIMIT_DISABLED.test(main)) {
    return "bin/main.ts disables rateLimit; drop rateLimit: false or mount crypto-shredding and audit by hand";
  }
  return undefined;
}

function sessionsEntry(sourceFile: SourceFile): Node | undefined {
  const declaration = sourceFile.getVariableDeclaration("APP_FEATURES");
  const initializer = declaration?.getInitializer();
  if (initializer === undefined) return undefined;
  const array = Node.isAsExpression(initializer) ? initializer.getExpression() : initializer;
  if (!Node.isArrayLiteralExpression(array)) return undefined;
  return array
    .getElements()
    .find(
      (element) =>
        Node.isCallExpression(element) &&
        element.getExpression().getText() === "createSessionsFeature",
    );
}

function importEdit(sourceFile: SourceFile): TextEdit {
  const last = sourceFile.getImportDeclarations().at(-1);
  const at = last?.getEnd() ?? 0;
  return {
    start: at,
    end: at,
    text: last === undefined ? `${COMPOSE_IMPORT}\n` : `\n${COMPOSE_IMPORT}`,
  };
}

export function transformSecurityBaselineStackSource(
  source: string,
  filePath = "src/run-config.ts",
): CodemodResult {
  const result: SiteLists = { rewrites: [], manual: [] };
  if (!isRunConfig(filePath) || !CHEAP_PREFILTER.test(source) || ALREADY_MOUNTED.test(source)) {
    return { output: source, ...result };
  }
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(filePath, source, { overwrite: true });
  const entry = sessionsEntry(sourceFile);
  if (entry === undefined) return { output: source, ...result };
  const line = entry.getStartLineNumber();
  const blocker = bootBlockerInMain(filePath);
  if (blocker !== undefined) {
    result.manual.push({ file: filePath, line, description: blocker });
    return { output: source, ...result };
  }
  result.rewrites.push({
    file: filePath,
    line,
    description: "mount crypto-shredding, rate-limiting and audit via composeSecurityStack",
  });
  const spread: TextEdit = {
    start: entry.getEnd(),
    end: entry.getEnd(),
    text: `, ${SECURITY_SPREAD}`,
  };
  return { output: applyEdits(source, [spread, importEdit(sourceFile)]), ...result };
}

if (import.meta.main) {
  await runCodemodCli(
    {
      name: "security-baseline-stack",
      transform: transformSecurityBaselineStackSource,
      isSkippedPath: () => false,
    },
    process.argv.slice(2),
  );
}
