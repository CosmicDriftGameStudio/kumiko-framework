import { describe, expect, it } from "bun:test";
import { transformTestingInjectionSource } from "../scripts/codemod/testing-injection.ts";

const APP_FILE = "/repo/apps/demo/src/__tests__/note.integration.test.ts";
const DEV = "@cosmicdrift/kumiko-dev-server/testing";

interface Fixture {
  readonly name: string;
  readonly input: string;
  readonly expected: string;
  readonly rewrites: number;
  readonly manual: number;
}

const FIXTURES: readonly Fixture[] = [
  {
    name: "moves the bound functions and keeps the types that stay",
    input: `import { type SeededTenant, seedTenant, setupAppTestStack } from "@cosmicdrift/kumiko-testing";\n`,
    expected: `import { type SeededTenant } from "@cosmicdrift/kumiko-testing";\nimport { seedTenant, setupAppTestStack } from "${DEV}";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "drops the old import when everything in it moved",
    input: `import { setupAppTestStack } from "@cosmicdrift/kumiko-testing";\nimport { x } from "y";\n`,
    expected: `import { x } from "y";\nimport { setupAppTestStack } from "${DEV}";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "merges into an existing dev-server/testing import",
    input: `import { seedTenant } from "@cosmicdrift/kumiko-testing";\nimport { setupAppTestStack } from "${DEV}";\n`,
    expected: `import { setupAppTestStack, seedTenant } from "${DEV}";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "keeps aliases and type-only imports",
    input: `import { type SetupAppTestStackOptions, seedTenant as seed } from "@cosmicdrift/kumiko-testing";\n`,
    expected: `import type { SetupAppTestStackOptions } from "${DEV}";\nimport { seedTenant as seed } from "${DEV}";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "moves createE2eSeedRoutes out of the seed-route subpath only",
    input: `import { createE2eSeedRoutes, type E2eExtraSeeder } from "@cosmicdrift/kumiko-testing/e2e/seed-route";\n`,
    expected: `import { type E2eExtraSeeder } from "@cosmicdrift/kumiko-testing/e2e/seed-route";\nimport { createE2eSeedRoutes } from "${DEV}";\n`,
    rewrites: 1,
    manual: 0,
  },
  {
    name: "leaves the subpaths and names that stay alone",
    input: `import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";\nimport { totpCode } from "@cosmicdrift/kumiko-testing/e2e";\nimport { seedTenant } from "./local";\n`,
    expected: `import { setupTestStack } from "@cosmicdrift/kumiko-testing/stack";\nimport { totpCode } from "@cosmicdrift/kumiko-testing/e2e";\nimport { seedTenant } from "./local";\n`,
    rewrites: 0,
    manual: 0,
  },
  {
    name: "flags a namespace import that uses a moved name",
    input: `import * as testing from "@cosmicdrift/kumiko-testing";\nconst stack = await testing.setupAppTestStack([]);\n`,
    expected: `import * as testing from "@cosmicdrift/kumiko-testing";\nconst stack = await testing.setupAppTestStack([]);\n`,
    rewrites: 0,
    manual: 1,
  },
];

describe("testing-injection codemod", () => {
  for (const fixture of FIXTURES) {
    it(fixture.name, () => {
      const result = transformTestingInjectionSource(fixture.input, APP_FILE);
      expect(result.output).toBe(fixture.expected);
      expect(result.rewrites).toHaveLength(fixture.rewrites);
      expect(result.manual).toHaveLength(fixture.manual);
    });
  }

  it("is idempotent", () => {
    const first = transformTestingInjectionSource(FIXTURES[0]?.input ?? "", APP_FILE);
    const second = transformTestingInjectionSource(first.output, APP_FILE);
    expect(second.output).toBe(first.output);
    expect(second.rewrites).toHaveLength(0);
  });
});
