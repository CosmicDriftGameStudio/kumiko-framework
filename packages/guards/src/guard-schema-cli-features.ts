#!/usr/bin/env bun
/**
 * Guard: a consumer's `runSchemaCli(...)` call must pass `features: FEATURES` imported from `kumiko/schema`.
 *
 * `allAppFeatures(config)` is raw (no bundled foundation: config, user, tenant, auth-email-password).
 * Only the managed `kumiko/schema.ts` composes it. With a raw or hand-built list the projection rebuild
 * after the migrations fails at deploy with "Feature X requires feature Y". Repos without
 * `kumiko/schema.ts` and the framework repo are not applicable. `composeEnvSchema` inputs are not checked.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Node, Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import type { RepoRoot } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

const SCAN: ScanSpec = { scope: "source", extensions: ["ts"], kinds: ["app", "library"] };

const SCHEMA_MODULE_REL = "kumiko/schema.ts";
const SCHEMA_MODULE_SPECIFIER = /(^|\/)kumiko\/schema(\.ts)?$/;
const SCHEMA_CLI_CALL = "runSchemaCli";
const OPTIONS_ARG_INDEX = 3;
const FEATURES_EXPORT = "FEATURES";
const FOUND_SNIPPET_MAX = 60;

const FIX_HINT =
  'Fix: `import { FEATURES } from "../kumiko/schema";` and pass `features: FEATURES`. ' +
  "allAppFeatures() is raw and a locally composed list drifts from kumiko/schema, which fails the rebuild at deploy.";

export type SchemaCliFinding = {
  readonly line: number;
  readonly message: string;
};

function importOf(sf: SourceFile, localName: string): { name: string; module: string } | undefined {
  for (const imp of sf.getImportDeclarations()) {
    for (const spec of imp.getNamedImports()) {
      if ((spec.getAliasNode()?.getText() ?? spec.getName()) === localName) {
        return { name: spec.getName(), module: imp.getModuleSpecifierValue() };
      }
    }
  }
  return undefined;
}

function isSchemaFeaturesImport(sf: SourceFile, localName: string): boolean {
  const imported = importOf(sf, localName);
  return (
    imported !== undefined &&
    imported.name === FEATURES_EXPORT &&
    SCHEMA_MODULE_SPECIFIER.test(imported.module)
  );
}

function snippet(node: Node): string {
  const flat = node.getText().replace(/\s+/g, " ");
  return flat.length > FOUND_SNIPPET_MAX ? `${flat.slice(0, FOUND_SNIPPET_MAX)}...` : flat;
}

function featuresValueOf(options: Node): Node | undefined | "no-literal" {
  if (!Node.isObjectLiteralExpression(options)) return "no-literal";
  const property = options.getProperty("features");
  if (property === undefined) return undefined;
  if (Node.isPropertyAssignment(property)) return property.getInitializer();
  if (Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return "no-literal";
}

function isRunSchemaCliCall(sf: SourceFile, callee: Node): boolean {
  if (!Node.isIdentifier(callee)) return false;
  const localName = callee.getText();
  return (importOf(sf, localName)?.name ?? localName) === SCHEMA_CLI_CALL;
}

function problemOf(sf: SourceFile, optionsArg: Node | undefined): string | undefined {
  if (optionsArg === undefined) {
    return `${SCHEMA_CLI_CALL} has no options argument, so the projection rebuild is skipped`;
  }
  const value = featuresValueOf(optionsArg);
  if (value === "no-literal") {
    return `${SCHEMA_CLI_CALL} options are not an object literal with a \`features\` property`;
  }
  if (value === undefined) return `${SCHEMA_CLI_CALL} options have no \`features\` property`;
  if (Node.isIdentifier(value) && isSchemaFeaturesImport(sf, value.getText())) return undefined;
  return `${SCHEMA_CLI_CALL} gets \`features: ${snippet(value)}\`, not ${FEATURES_EXPORT} from kumiko/schema`;
}

export function findSchemaCliFeatureProblems(sf: SourceFile): SchemaCliFinding[] {
  const findings: SchemaCliFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isRunSchemaCliCall(sf, call.getExpression())) continue;
    const problem = problemOf(sf, call.getArguments()[OPTIONS_ARG_INDEX]);
    if (problem !== undefined) {
      findings.push({ line: call.getStartLineNumber(), message: `${problem}. ${FIX_HINT}` });
    }
  }
  return findings;
}

function hasSchemaModule(root: RepoRoot): boolean {
  return existsSync(join(root.absPath, SCHEMA_MODULE_REL));
}

export const check: RepoCheck = {
  name: "Schema CLI Features Guard",
  hint:
    "Pass `features: FEATURES` imported from kumiko/schema to runSchemaCli; allAppFeatures() is raw " +
    "and breaks the projection rebuild at deploy.",
  run(roots) {
    const applicable = roots.filter((root) => root.kind !== "framework" && hasSchemaModule(root));
    if (applicable.length === 0) return { violations: [], matchedFiles: 0, notApplicable: true };

    // Manifest excludes must not hide bin/kumiko.ts: kumiko-studio and phronexsis exclude it from other guards.
    const paths = scanFiles(SCAN, applicable, { security: true });
    const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
    const violations: GuardViolation[] = [];
    for (const absPath of paths) {
      const text = readFileSync(absPath, "utf-8");
      if (!text.includes(SCHEMA_CLI_CALL)) continue;
      const sf = project.createSourceFile(absPath, text, { overwrite: true });
      for (const finding of findSchemaCliFeatureProblems(sf)) {
        violations.push({
          file: relative(process.cwd(), absPath),
          line: finding.line,
          message: finding.message,
        });
      }
    }
    return { violations, matchedFiles: paths.length, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
