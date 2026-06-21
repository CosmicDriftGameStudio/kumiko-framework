import { expect, test } from "bun:test";
import { syncLockVersions } from "./sync-lock-workspace-versions";

// Mirrors the real bun.lock shape: a workspace package carries a `"name"` +
// `"version"` metadata pair (6-space indent), while a dependency *reference*
// is a plain `"name": "<range>"` line. The sync must rewrite the former and
// leave the latter alone — if the lock format ever drifts from this shape the
// regex stops matching and these assertions go red.
const STALE_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "packages/framework": {
      "name": "@cosmicdrift/kumiko-framework",
      "version": "0.67.0",
    },
    "packages/renderer": {
      "name": "@cosmicdrift/kumiko-renderer",
      "version": "0.57.2",
      "dependencies": {
        "@cosmicdrift/kumiko-framework": "0.67.0",
      },
    },
  },
}`;

const FRESH = new Map([
  ["@cosmicdrift/kumiko-framework", "0.68.0"],
  ["@cosmicdrift/kumiko-renderer", "0.68.0"],
]);

test("rewrites every stale workspace version to its package.json version", () => {
  const { lock, changed } = syncLockVersions(STALE_LOCK, FRESH);
  expect(changed).toEqual([
    "@cosmicdrift/kumiko-framework: 0.67.0 → 0.68.0",
    "@cosmicdrift/kumiko-renderer: 0.57.2 → 0.68.0",
  ]);
  expect(lock).toContain('"name": "@cosmicdrift/kumiko-framework",\n      "version": "0.68.0"');
  expect(lock).toContain('"name": "@cosmicdrift/kumiko-renderer",\n      "version": "0.68.0"');
});

test("leaves a dependency reference line untouched — only the metadata pair is rewritten", () => {
  const { lock } = syncLockVersions(STALE_LOCK, FRESH);
  expect(lock).toContain('"@cosmicdrift/kumiko-framework": "0.67.0"');
});

test("reports no changes when the lock already matches package.json", () => {
  const { lock, changed, unmatched } = syncLockVersions(
    STALE_LOCK,
    new Map([
      ["@cosmicdrift/kumiko-framework", "0.67.0"],
      ["@cosmicdrift/kumiko-renderer", "0.57.2"],
    ]),
  );
  expect(changed).toEqual([]);
  expect(unmatched).toEqual([]);
  expect(lock).toBe(STALE_LOCK);
});

// 538#2: `changed.length === 0` conflated "already in sync" with "the regex
// matched nothing because the lock format drifted" — the latter is how stale
// internal pins shipped silently. `unmatched` separates the two.
test("flags a workspace package the lock doesn't carry — the silent format-drift guard", () => {
  const { changed, unmatched } = syncLockVersions(
    STALE_LOCK,
    new Map([["@cosmicdrift/kumiko-studio", "0.68.0"]]),
  );
  expect(changed).toEqual([]);
  expect(unmatched).toEqual(["@cosmicdrift/kumiko-studio"]);
});
