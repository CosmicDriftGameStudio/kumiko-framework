import { describe, expect, test } from "bun:test";
import { type FileChange, isVersionOnlyChange } from "../ci-version-only-pr";

function pkg(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    name: "@cosmicdrift/kumiko-a",
    version: "1.0.0",
    scripts: { test: "bun test" },
    dependencies: { "@cosmicdrift/kumiko-b": "1.0.0", zod: "^4.0.0" },
    ...overrides,
  });
}

const bumpedA: FileChange = {
  status: "M",
  path: "packages/a/package.json",
  before: pkg({}),
  after: pkg({ version: "1.1.0" }),
};
const bumpedB: FileChange = {
  status: "M",
  path: "packages/b/package.json",
  before: pkg({ name: "@cosmicdrift/kumiko-b", dependencies: {} }),
  after: pkg({ name: "@cosmicdrift/kumiko-b", version: "1.1.0", dependencies: {} }),
};

const versionPrFixture: FileChange[] = [
  { status: "D", path: ".changeset/some-change.md" },
  { status: "M", path: "CHANGELOG.md" },
  { status: "M", path: "packages/a/CHANGELOG.md" },
  { status: "A", path: "packages/a/src/changes.json" },
  { status: "M", path: "docs/reference/migration-guide.md" },
  bumpedA,
  bumpedB,
  {
    status: "M",
    path: "package.json",
    before: pkg({ name: "root" }),
    after: pkg({ name: "root", version: "2.0.0" }),
  },
  { status: "M", path: "bun.lock", diffLines: ['-    "version": "1.0.0",', '+    "version": "1.1.0",'] },
];

describe("isVersionOnlyChange", () => {
  test("accepts a realistic generated Version PR", () => {
    expect(isVersionOnlyChange(versionPrFixture)).toEqual({ versionOnly: true, reasons: [] });
  });

  test("accepts an internal dependency pin that follows a bumped package", () => {
    const dependent: FileChange = {
      status: "M",
      path: "packages/c/package.json",
      before: pkg({ name: "c" }),
      after: pkg({
        name: "c",
        dependencies: { "@cosmicdrift/kumiko-b": "1.1.0", zod: "^4.0.0" },
      }),
    };
    expect(isVersionOnlyChange([bumpedB, dependent]).versionOnly).toBe(true);
  });

  test.each([
    ["^1.2.3", true],
    ["workspace:*", true],
    ["file:../x", false],
    ["npm:evil@1.0.0", false],
    ["https://example.com/x.tgz", false],
  ])("a pin of a bumped package changing to %s is version-only: %p", (value, expected) => {
    const dependent: FileChange = {
      status: "M",
      path: "packages/c/package.json",
      before: pkg({ name: "c" }),
      after: pkg({ name: "c", dependencies: { "@cosmicdrift/kumiko-b": value, zod: "^4.0.0" } }),
    };
    expect(isVersionOnlyChange([bumpedB, dependent]).versionOnly).toBe(expected);
  });

  test.each<[string, FileChange]>([
    [
      "package.json with a changed scripts entry",
      {
        status: "M",
        path: "packages/a/package.json",
        before: pkg({}),
        after: pkg({ version: "1.1.0", scripts: { test: "bun test --watch" } }),
      },
    ],
    [
      "package.json with a new dependency",
      {
        status: "M",
        path: "packages/a/package.json",
        before: pkg({}),
        after: pkg({
          version: "1.1.0",
          dependencies: { "@cosmicdrift/kumiko-b": "1.0.0", zod: "^4.0.0", evil: "1.0.0" },
        }),
      },
    ],
    [
      "package.json with a foreign dependency version change",
      {
        status: "M",
        path: "packages/a/package.json",
        before: pkg({}),
        after: pkg({
          version: "1.1.0",
          dependencies: { "@cosmicdrift/kumiko-b": "1.0.0", zod: "^5.0.0" },
        }),
      },
    ],
    [
      "bun.lock with a non-version line",
      {
        status: "M",
        path: "bun.lock",
        diffLines: ['-    "version": "1.0.0",', '+    "left-pad": ["left-pad@1.3.0"],'],
      },
    ],
    ["an added changeset", { status: "A", path: ".changeset/x.md" }],
    ["a changed ts file", { status: "M", path: "packages/a/src/index.ts" }],
    ["the CI workflow", { status: "M", path: ".github/workflows/ci.yml" }],
    ["a rename", { status: "R", path: "packages/a/CHANGELOG.md" }],
  ])("rejects %s mixed into a Version PR", (_label, offending) => {
    const result = isVersionOnlyChange([...versionPrFixture, offending]);
    expect(result.versionOnly).toBe(false);
    expect(result.reasons).toContain(`${offending.status} ${offending.path}`);
  });

  test("rejects an empty change list", () => {
    expect(isVersionOnlyChange([]).versionOnly).toBe(false);
  });
});
