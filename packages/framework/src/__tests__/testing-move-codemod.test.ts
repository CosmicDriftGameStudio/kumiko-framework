import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { transformTestingMoveSource } from "../scripts/codemod/testing-move.ts";

const FIXTURES_DIR = join(import.meta.dir, "fixtures", "testing-move");
const CODEMOD_SCRIPT = join(import.meta.dir, "..", "scripts", "codemod", "testing-move.ts");

const CONSUMER_FILE = "/repo/packages/bundled-features/src/note/sample.ts";
const FRAMEWORK_TEST_FILE = "/repo/packages/framework/src/pipeline/__tests__/sample.test.ts";
const TESTING_PACKAGE_FILE = "/repo/packages/testing/src/preload/sample.ts";

function readFixture(name: string): { input: string; expected: string } {
  return {
    input: readFileSync(join(FIXTURES_DIR, `${name}.input.ts`), "utf8"),
    expected: readFileSync(join(FIXTURES_DIR, `${name}.expected.ts`), "utf8"),
  };
}

const FIXTURE_CASES: ReadonlyArray<{
  readonly name: string;
  readonly filePath: string;
  readonly rewrites: number;
  readonly manual: number;
}> = [
  { name: "stack", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "stack-test-users-split", filePath: CONSUMER_FILE, rewrites: 2, manual: 0 },
  { name: "testing-bridge-stub-split", filePath: CONSUMER_FILE, rewrites: 2, manual: 0 },
  { name: "handler-context", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "real-providers", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "e2e-generator", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "type-only", filePath: CONSUMER_FILE, rewrites: 3, manual: 0 },
  { name: "export-from", filePath: CONSUMER_FILE, rewrites: 3, manual: 0 },
  { name: "dynamic-import", filePath: CONSUMER_FILE, rewrites: 4, manual: 1 },
  { name: "mock-module", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "relative-framework-import", filePath: FRAMEWORK_TEST_FILE, rewrites: 5, manual: 0 },
  { name: "in-testing-package", filePath: TESTING_PACKAGE_FILE, rewrites: 2, manual: 0 },
  { name: "namespace-split", filePath: CONSUMER_FILE, rewrites: 1, manual: 1 },
  { name: "namespace-plain", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "merge-existing", filePath: CONSUMER_FILE, rewrites: 1, manual: 0 },
  { name: "side-effect-import", filePath: CONSUMER_FILE, rewrites: 2, manual: 0 },
  { name: "already-migrated", filePath: CONSUMER_FILE, rewrites: 0, manual: 0 },
];

describe("testing-move codemod fixtures", () => {
  for (const { name, filePath, rewrites, manual } of FIXTURE_CASES) {
    it(`${name}: output matches the expected file`, () => {
      const { input, expected } = readFixture(name);
      const result = transformTestingMoveSource(input, filePath);

      expect(result.output).toBe(expected);
      expect(result.rewrites).toHaveLength(rewrites);
      expect(result.manual).toHaveLength(manual);
    });

    it(`${name}: a second run on the expected file changes nothing`, () => {
      const { expected } = readFixture(name);
      const second = transformTestingMoveSource(expected, filePath);

      expect(second.output).toBe(expected);
      expect(second.rewrites).toHaveLength(0);
    });
  }
});

describe("testing-move codemod behavior", () => {
  it("splits TestUsers off the stack import into the framework seeding subpath", () => {
    const { expected } = readFixture("stack-test-users-split");

    expect(expected).toContain(
      'import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";',
    );
    expect(expected).toContain(
      'import { TestUsers, testTenantId, createTestUser } from "@cosmicdrift/kumiko-framework/seeding";',
    );
  });

  it("merges moved names into an existing import of the same target", () => {
    const { expected } = readFixture("merge-existing");

    expect(expected.match(/kumiko-framework\/seeding/g)).toHaveLength(1);
    expect(expected).toContain("import { TestUsers, testUserId }");
  });

  it("keeps type-only imports type-only and preserves aliases", () => {
    const { expected } = readFixture("type-only");

    expect(expected).toContain(
      'import type { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";',
    );
    expect(expected).toContain("createRequestHelper as makeHelper");
  });

  it("points relative imports inside the framework at the production files", () => {
    const { expected } = readFixture("relative-framework-import");

    expect(expected).toContain('from "../../seeding/seed-users.js"');
    expect(expected).toContain('from "../../engine/bridge-stub.js"');
    expect(expected).not.toContain("../../stack");
    expect(expected).not.toContain("../../testing");
  });

  it("uses relative paths for targets inside the testing package", () => {
    const { expected } = readFixture("in-testing-package");

    expect(expected).toContain('from "../helpers/index.js"');
    expect(expected).toContain('from "../stack/index.js"');
  });

  it("reports the line of a namespace import that mixes moved names", () => {
    const { input } = readFixture("namespace-split");
    const result = transformTestingMoveSource(input, CONSUMER_FILE);

    expect(result.manual.map((site) => site.line)).toEqual([1]);
    expect(result.output).toContain('import * as stack from "@cosmicdrift/kumiko-framework/stack"');
  });

  it("leaves unrelated imports and mock.module targets untouched", () => {
    const { expected } = readFixture("mock-module");

    expect(expected).toContain('mock.module("@cosmicdrift/kumiko-framework/crypto"');
  });
});

describe("testing-move codemod CLI", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "testing-move-cli-"));
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function writeProjectFile(relativePath: string, content: string): string {
    const abs = join(workDir, relativePath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return abs;
  }

  async function runCodemod(...args: string[]): Promise<{ code: number; output: string }> {
    const proc = Bun.spawn({
      cmd: ["bun", CODEMOD_SCRIPT, ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, output: `${stdout}${stderr}` };
  }

  const OLD_SOURCE = [
    'import { setupTestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";',
    'import { waitFor } from "@cosmicdrift/kumiko-framework/testing";',
    "export const probe = [setupTestStack, TestUsers, waitFor];",
    "",
  ].join("\n");

  it("--check exits 1 while old imports remain and 0 after the write run", async () => {
    const file = writeProjectFile("src/feature.ts", OLD_SOURCE);

    const before = await runCodemod(workDir, "--check");
    expect(before.code).toBe(1);
    expect(before.output).toContain("rewritten");
    expect(readFileSync(file, "utf8")).toBe(OLD_SOURCE);

    const write = await runCodemod(workDir, "--no-format");
    expect(write.code).toBe(0);
    const written = readFileSync(file, "utf8");
    expect(written).toContain('"@cosmicdrift/kumiko-testing/stack"');
    expect(written).toContain('"@cosmicdrift/kumiko-framework/seeding"');
    expect(written).toContain('"@cosmicdrift/kumiko-testing/helpers"');
    expect(written).not.toContain("kumiko-framework/stack");

    const after = await runCodemod(workDir, "--check");
    expect(after.code).toBe(0);
  });

  it("--dry-run reports but changes nothing and exits 0", async () => {
    const file = writeProjectFile("src/feature.ts", OLD_SOURCE);

    const dryRun = await runCodemod(workDir, "--dry-run");

    expect(dryRun.code).toBe(0);
    expect(dryRun.output).toContain("rewritable: 2");
    expect(readFileSync(file, "utf8")).toBe(OLD_SOURCE);
  });

  it("--check also fails on a manual site", async () => {
    writeProjectFile(
      "src/feature.ts",
      'import * as stack from "@cosmicdrift/kumiko-framework/stack";\nexport const probe = stack.TestUsers;\n',
    );

    const check = await runCodemod(workDir, "--check");

    expect(check.code).toBe(1);
    expect(check.output).toContain("manual: 1");
  });

  it("skips fixtures, declaration files, node_modules and the deprecated shims", async () => {
    const fixture = writeProjectFile("src/__tests__/fixtures/a.input.ts", OLD_SOURCE);
    const declaration = writeProjectFile("src/types.d.ts", OLD_SOURCE);
    const vendored = writeProjectFile("node_modules/pkg/index.ts", OLD_SOURCE);
    const shim = writeProjectFile("packages/framework/src/stack/index.ts", OLD_SOURCE);

    const check = await runCodemod(workDir, "--check");

    expect(check.code).toBe(0);
    for (const file of [fixture, declaration, vendored, shim]) {
      expect(readFileSync(file, "utf8")).toBe(OLD_SOURCE);
    }
  });

  it("rejects conflicting mode flags with exit 2", async () => {
    const result = await runCodemod(workDir, "--check", "--dry-run");

    expect(result.code).toBe(2);
  });
});
