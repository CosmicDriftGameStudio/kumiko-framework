#!/usr/bin/env bun
/**
 * Guard: *.integration.ts / *.integration.test.ts files must not construct
 * a parallel server stack. Concretely: if the test calls neither
 * `buildServer(...)` nor `setupTestStack(...)`, but still instantiates
 * pipeline internals like `createDispatcher`, `createOutboxPoller`, or
 * `createLifecycleHooks` directly, it builds its own test reality next to
 * the production wiring — exactly the drift source that produces green
 * tests over a broken prod path.
 *
 * Allowed opt-out: `// @no-server-stack: <reason>` anywhere in the file.
 * Meant for pure adapter integration tests (DB, Redis, Meilisearch) that
 * deliberately don't spin up a server.
 *
 * Usage:
 *   bun guards/guard-test-stack-drift.ts
 */

import * as path from "node:path";
import { Project, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type GuardViolation,
  type RepoCheck,
  reportResults,
  runRepoChecks,
} from "./_lib/guard-kit";
import { frameworkTsConfigPath } from "./_lib/roots";
import { type ScanSpec, scanFiles } from "./_lib/scan-scope";

const ROOT = process.cwd();

// Beide Suffixe: `.integration.ts` (legacy) + `.integration.test.ts` (canonical
// nach bun-test-cutover). Transition-safe — matcht main (legacy) und migrierte
// Branches gleichermaßen.
const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts"],
  kinds: ["framework"],
  frameworkWithin: [
    "packages/framework/src/**/*.integration.ts",
    "packages/framework/src/**/*.integration.test.ts",
    "packages/bundled-features/src/**/*.integration.ts",
    "packages/bundled-features/src/**/*.integration.test.ts",
  ],
};

// Functions whose call in an integration test signals "I build the server".
// If any of these are called, the file is considered "properly wired".
const SERVER_ENTRYPOINTS = new Set(["buildServer", "setupTestStack"]);

// Pipeline-internal factories. Calling any of these WITHOUT also calling a
// server entrypoint means the test is assembling its own parallel stack.
const FORBIDDEN_WITHOUT_SERVER = new Set([
  "createDispatcher",
  "createOutboxPoller",
  "createLifecycleHooks",
]);

const OPT_OUT_MARKER = /\/\/\s*@no-server-stack:/i;

const INTEGRATION_FILE = /\.integration(\.test)?\.ts$/;

export function isIntegrationTestFile(filePath: string): boolean {
  return INTEGRATION_FILE.test(filePath);
}

export interface Violation {
  file: string;
  reason: string;
  forbiddenCalls: Array<{ name: string; line: number }>;
}

function collectCallNames(sf: SourceFile): Map<string, number[]> {
  const calls = new Map<string, number[]>();
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const name = call.getExpression().getText();
    const arr = calls.get(name) ?? [];
    arr.push(call.getStartLineNumber());
    calls.set(name, arr);
  }
  return calls;
}

function hasOptOutMarker(sf: SourceFile): boolean {
  return OPT_OUT_MARKER.test(sf.getFullText());
}

export function scanFile(sf: SourceFile): Violation | null {
  if (hasOptOutMarker(sf)) return null;

  const calls = collectCallNames(sf);

  const hasServerEntrypoint = [...SERVER_ENTRYPOINTS].some((name) => calls.has(name));
  if (hasServerEntrypoint) return null;

  const forbiddenHits: Array<{ name: string; line: number }> = [];
  for (const [name, lines] of calls) {
    if (FORBIDDEN_WITHOUT_SERVER.has(name)) {
      for (const line of lines) forbiddenHits.push({ name, line });
    }
  }

  if (forbiddenHits.length === 0) return null;

  return {
    file: path.relative(ROOT, sf.getFilePath()),
    reason: "calls pipeline internals without buildServer/setupTestStack",
    forbiddenCalls: forbiddenHits,
  };
}

export const check: RepoCheck = {
  name: "Test-Stack-Drift Guard",
  hint:
    "Integration tests must call buildServer or setupTestStack — otherwise they test a different " +
    "reality than prod. Pure adapter tests without a server stack: // @no-server-stack: <reason>.",
  run(roots) {
    if (!roots.some((r) => r.kind === "framework")) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }

    const project = new Project({
      tsConfigFilePath: frameworkTsConfigPath(),
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
    });
    const paths = scanFiles(SCAN, roots);
    for (const p of paths) project.addSourceFileAtPath(p);

    const violations: GuardViolation[] = [];
    for (const sf of project.getSourceFiles()) {
      if (!isIntegrationTestFile(sf.getFilePath())) continue;
      const v = scanFile(sf);
      if (v === null) continue;
      for (const c of v.forbiddenCalls) {
        violations.push({ file: v.file, line: c.line, message: `${v.reason}: ${c.name}(...)` });
      }
    }

    return { violations, matchedFiles: paths.length, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
