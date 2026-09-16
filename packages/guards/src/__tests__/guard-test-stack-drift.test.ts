// Unit tests for the test-stack-drift guard helpers. Synthetic in-memory
// ts-morph sources exercise the detection independent of the running monorepo,
// and the file-match predicate pins which integration suffixes are scanned.

import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { isIntegrationTestFile, scanFile } from "../guard-test-stack-drift";

function parseSource(file: string, source: string): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: true,
  });
  return project.createSourceFile(file, source);
}

describe("isIntegrationTestFile", () => {
  test("matches the canonical .integration.test.ts suffix", () => {
    expect(isIntegrationTestFile("/repo/packages/framework/src/x.integration.test.ts")).toBe(true);
  });

  test("matches the legacy .integration.ts suffix", () => {
    expect(isIntegrationTestFile("/repo/packages/framework/src/x.integration.ts")).toBe(true);
  });

  test("rejects plain unit tests and non-integration sources", () => {
    expect(isIntegrationTestFile("/repo/packages/framework/src/x.test.ts")).toBe(false);
    expect(isIntegrationTestFile("/repo/packages/framework/src/x.ts")).toBe(false);
  });
});

describe("scanFile", () => {
  test("blocks a .integration.test.ts that builds a parallel stack", () => {
    const sf = parseSource(
      "/repo/packages/framework/src/feature.integration.test.ts",
      `import { createDispatcher } from "@cosmicdrift/kumiko-framework";
import { createOutboxPoller } from "@cosmicdrift/kumiko-framework";
import { createLifecycleHooks } from "@cosmicdrift/kumiko-framework";

const dispatcher = createDispatcher({});
const poller = createOutboxPoller({});
const hooks = createLifecycleHooks({});`,
    );
    const violation = scanFile(sf);
    expect(violation).not.toBeNull();
    const names = violation?.forbiddenCalls.map((c) => c.name).sort();
    expect(names).toEqual(["createDispatcher", "createLifecycleHooks", "createOutboxPoller"]);
  });

  test("permits an integration test that goes through setupTestStack", () => {
    const sf = parseSource(
      "/repo/packages/framework/src/feature.integration.test.ts",
      `import { setupTestStack } from "@cosmicdrift/kumiko-framework/testing";
import { createDispatcher } from "@cosmicdrift/kumiko-framework";

const stack = setupTestStack();
const dispatcher = createDispatcher({});`,
    );
    expect(scanFile(sf)).toBeNull();
  });

  test("permits an integration test that goes through buildServer", () => {
    const sf = parseSource(
      "/repo/packages/framework/src/feature.integration.test.ts",
      `import { buildServer } from "@cosmicdrift/kumiko-framework";
import { createOutboxPoller } from "@cosmicdrift/kumiko-framework";

const server = buildServer({});
const poller = createOutboxPoller({});`,
    );
    expect(scanFile(sf)).toBeNull();
  });

  test("respects the @no-server-stack opt-out marker", () => {
    const sf = parseSource(
      "/repo/packages/framework/src/adapter.integration.test.ts",
      `// @no-server-stack: pure redis adapter test, no server needed
import { createDispatcher } from "@cosmicdrift/kumiko-framework";

const dispatcher = createDispatcher({});`,
    );
    expect(scanFile(sf)).toBeNull();
  });

  test("ignores integration tests with no pipeline internals", () => {
    const sf = parseSource(
      "/repo/packages/framework/src/adapter.integration.test.ts",
      `import { connect } from "node:net";
const socket = connect(5432);`,
    );
    expect(scanFile(sf)).toBeNull();
  });
});
