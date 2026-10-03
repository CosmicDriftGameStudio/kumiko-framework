// A guard run in `<parent>/.wt/<repo>` (or any repo inside a parent workspace) must
// see exactly what a fresh CI checkout sees: files of neighbour repos are external,
// like a package under node_modules. Real directories on disk, no fs mocks.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoManifest } from "@cosmicdrift/kumiko-repo-manifest";
import {
  buildSharedProject,
  isExternalSourcePath,
  isOutsideRepoRoot,
  runGuards,
} from "../_lib/guard-kit";
import { UI_GUARDS } from "../run-ui-guards";
import { writeRepo } from "./parent-workspace-fixture";

const APP_MANIFEST: RepoManifest = {
  kind: "app",
  sourceRoots: ["src"],
  testGlobs: ["src/**/*.{test,integration}.{ts,tsx}"],
};

const FRAMED_SECTION = "export function NotesSection() { return <Card>x</Card>; }\n";
const RAW_BUTTON = "export function Raw() { return <button>x</button>; }\n";
const CLIENT_PLUGIN = (specifier: string) =>
  `import { NotesSection } from "${specifier}";\n` +
  "export function demoClient() {\n  return { extensionSectionComponents: { notes: NotesSection } };\n}\n";

let parent: string;
let appDir: string;
let neighborDir: string;
let originalCwd: string;

function write(dir: string, relative: string, content: string): void {
  const target = join(dir, relative);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content);
}

// `resolvedNeighborFiles` stand in for what ts-morph adds to the project lazily once
// a guard touches the type checker: the import follower then finds the target.
function uiViolationFiles(resolvedNeighborFiles: readonly string[] = []): string[] {
  const project = buildSharedProject(UI_GUARDS);
  for (const file of resolvedNeighborFiles) project.addSourceFileAtPath(file);
  return runGuards(UI_GUARDS, project).flatMap((result) =>
    (result.outcome?.violations ?? []).map((violation) => violation.file),
  );
}

beforeEach(() => {
  originalCwd = process.cwd();
  parent = realpathSync(mkdtempSync(join(tmpdir(), "repo-root-boundary-")));
  writeFileSync(join(parent, "package.json"), JSON.stringify({ name: "cosmicdriftgamestudio" }));
  appDir = join(parent, "app");
  neighborDir = join(parent, ".wt", "neighbor-x");
  writeRepo(appDir, { name: "app", layout: { manifest: APP_MANIFEST } });
  writeRepo(neighborDir, { name: "neighbor", layout: { manifest: APP_MANIFEST } });
  write(neighborDir, "src/notes-section.tsx", FRAMED_SECTION);
  write(neighborDir, "src/raw.tsx", RAW_BUTTON);
  process.chdir(appDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(parent, { recursive: true, force: true });
});

describe("isOutsideRepoRoot", () => {
  test("a neighbour repo file is outside, a file of the local repo and the root itself are not", () => {
    expect(isOutsideRepoRoot(join(neighborDir, "src/raw.tsx"))).toBe(true);
    expect(isOutsideRepoRoot(join(parent, "app-sibling/x.ts"))).toBe(true);
    expect(isOutsideRepoRoot(join(appDir, "src/index.ts"))).toBe(false);
    expect(isOutsideRepoRoot(appDir)).toBe(false);
  });

  test("node_modules paths and outside-root paths are both external", () => {
    expect(isExternalSourcePath(join(appDir, "node_modules/pkg/index.tsx"))).toBe(true);
    expect(isExternalSourcePath(join(neighborDir, "src/raw.tsx"))).toBe(true);
    expect(isExternalSourcePath(join(appDir, "src/index.ts"))).toBe(false);
  });

  test("a symlink inside the repo that points into the neighbour counts as outside", () => {
    symlinkSync(join(neighborDir, "src"), join(appDir, "src", "linked"));
    expect(isOutsideRepoRoot(join(appDir, "src", "linked", "raw.tsx"))).toBe(true);
  });
});

describe("UI guards in a repo inside a parent workspace", () => {
  test("the shared project holds no neighbour file, even behind a symlink", () => {
    symlinkSync(join(neighborDir, "src"), join(appDir, "src", "linked"));
    const files = buildSharedProject(UI_GUARDS)
      .getSourceFiles()
      .map((sf) => sf.getFilePath());
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((file) => file.startsWith(neighborDir))).toEqual([]);
  });

  test("no finding from the neighbour repo, and the app's import into it is not followed", () => {
    write(
      appDir,
      "src/web/client-plugin.tsx",
      CLIENT_PLUGIN("../../../.wt/neighbor-x/src/notes-section"),
    );
    const files = uiViolationFiles([join(neighborDir, "src/notes-section.tsx")]);
    expect(files.filter((file) => file.includes("neighbor-x"))).toEqual([]);
    expect(files.filter((file) => file.includes("notes-section"))).toEqual([]);
  });

  test("a workspace-linked package outside the repo root is external, under the link and the real path", () => {
    write(neighborDir, "package.json", JSON.stringify({ name: "@scope/neighbor" }));
    mkdirSync(join(appDir, "node_modules", "@scope"), { recursive: true });
    const linkDir = join(appDir, "node_modules", "@scope", "neighbor");
    symlinkSync(neighborDir, linkDir);
    write(appDir, "src/web/client-plugin.tsx", CLIENT_PLUGIN("@scope/neighbor/src/notes-section"));

    expect(isExternalSourcePath(join(linkDir, "src/raw.tsx"))).toBe(true);

    const files = buildSharedProject(UI_GUARDS)
      .getSourceFiles()
      .map((sf) => sf.getFilePath());
    expect(
      files.filter((file) => file.startsWith(neighborDir) || file.startsWith(linkDir)),
    ).toEqual([]);

    for (const resolved of [
      join(linkDir, "src/notes-section.tsx"),
      join(neighborDir, "src/notes-section.tsx"),
    ]) {
      const violationFiles = uiViolationFiles([resolved]);
      expect(violationFiles.filter((file) => file.includes("neighbor"))).toEqual([]);
      expect(violationFiles.filter((file) => file.includes("notes-section"))).toEqual([]);
    }
  });

  test("control: the same framed component inside the repo is still flagged", () => {
    write(appDir, "src/notes-section.tsx", FRAMED_SECTION);
    write(appDir, "src/web/client-plugin.tsx", CLIENT_PLUGIN("../notes-section"));
    expect(uiViolationFiles().some((file) => file.includes("notes-section"))).toBe(true);
  });
});
