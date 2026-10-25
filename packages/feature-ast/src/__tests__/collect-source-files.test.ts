import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectSourceFiles,
  envWithoutGitRepositoryOverrides,
} from "../scripts/codemod/collect-source-files.ts";

const isTsFile = (name: string): boolean => /\.tsx?$/.test(name);

function withTree(build: (root: string) => void, run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "collect-source-files-"));
  try {
    build(root);
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("collectSourceFiles", () => {
  it("terminates on a symlink cycle and skips build/vendor directories", () => {
    withTree(
      (root) => {
        mkdirSync(join(root, "src"));
        mkdirSync(join(root, "dist"));
        mkdirSync(join(root, "node_modules"));
        writeFileSync(join(root, "src", "a.ts"), "export {};\n");
        writeFileSync(join(root, "dist", "b.ts"), "export {};\n");
        writeFileSync(join(root, "node_modules", "c.ts"), "export {};\n");
        symlinkSync(root, join(root, "src", "loop"));
      },
      (root) => {
        expect(collectSourceFiles([root], { isMigratableFile: isTsFile })).toEqual([
          join(root, "src", "a.ts"),
        ]);
      },
    );
  });

  it("leaves out files the repository's .gitignore excludes", () => {
    withTree(
      (root) => {
        expect(
          Bun.spawnSync({
            cmd: ["git", "init", "-q"],
            cwd: root,
            env: envWithoutGitRepositoryOverrides(),
          }).exitCode,
        ).toBe(0);
        writeFileSync(join(root, ".gitignore"), "generated/\n*.local.ts\n");
        mkdirSync(join(root, "generated"));
        mkdirSync(join(root, "src"));
        writeFileSync(join(root, "generated", "client.ts"), "export {};\n");
        writeFileSync(join(root, "src", "scratch.local.ts"), "export {};\n");
        writeFileSync(join(root, "src", "a.ts"), "export {};\n");
      },
      (root) => {
        expect(collectSourceFiles([root], { isMigratableFile: isTsFile })).toEqual([
          join(root, "src", "a.ts"),
        ]);
        expect(collectSourceFiles([join(root, "src")], { isMigratableFile: isTsFile })).toEqual([
          join(root, "src", "a.ts"),
        ]);
      },
    );
  });

  it("collects unfiltered files when git is not installed", () => {
    withTree(
      (root) => {
        mkdirSync(join(root, "empty-bin"));
        writeFileSync(join(root, ".gitignore"), "generated/\n");
        mkdirSync(join(root, "generated"));
        writeFileSync(join(root, "generated", "client.ts"), "export {};\n");
        writeFileSync(join(root, "a.ts"), "export {};\n");
      },
      (root) => {
        const originalPath = process.env["PATH"];
        process.env["PATH"] = join(root, "empty-bin");
        try {
          expect(collectSourceFiles([root], { isMigratableFile: isTsFile }).sort()).toEqual([
            join(root, "a.ts"),
            join(root, "generated", "client.ts"),
          ]);
        } finally {
          process.env["PATH"] = originalPath;
        }
      },
    );
  });

  it("honours extra skipped directory names", () => {
    withTree(
      (root) => {
        mkdirSync(join(root, "__tests__"));
        writeFileSync(join(root, "__tests__", "t.ts"), "export {};\n");
        writeFileSync(join(root, "keep.ts"), "export {};\n");
      },
      (root) => {
        expect(
          collectSourceFiles([root], {
            isMigratableFile: isTsFile,
            extraSkippedDirNames: ["__tests__"],
          }),
        ).toEqual([join(root, "keep.ts")]);
      },
    );
  });
});
