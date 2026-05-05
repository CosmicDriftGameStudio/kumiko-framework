// scaffoldFeature tests — verify the CLI's `create` subcommand produces
// a valid, parsable feature workspace. Strategy: scaffold into an
// in-tmpdir destination, then read the output back and assert:
//   1. package.json shape (workspace name, framework dep)
//   2. feature.ts is parsable by the canonical-form parser without
//      ParseErrors and contains the Schema-Version-Header
//   3. featureName extracted by the parser matches what was scaffolded
//   4. Validation: bad names fail loudly, existing destination refuses
//      to overwrite

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSourceFile, VERSION_HEADER } from "@cosmicdrift/kumiko-framework/engine";
import { Project } from "ts-morph";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { scaffoldFeature } from "../scaffold-feature";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "kumiko-scaffold-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("scaffoldFeature — output shape", () => {
  test("creates package.json + tsconfig.json + src/feature.ts at the resolved destination", () => {
    const result = scaffoldFeature({
      name: "todoList",
      destination: join(workdir, "todoList"),
    });
    expect(existsSync(result.packageJsonFile)).toBe(true);
    expect(existsSync(result.tsconfigFile)).toBe(true);
    expect(existsSync(result.featureFile)).toBe(true);
    expect(result.featureName).toBe("todoList");
    expect(result.packageName).toBe("@cosmicdrift/kumiko-sample-todo-list");
  });

  test("tsconfig.json is strict + bundler-resolution + no-emit", () => {
    const result = scaffoldFeature({
      name: "todoList",
      destination: join(workdir, "todoList"),
    });
    const tsconfig = JSON.parse(readFileSync(result.tsconfigFile, "utf8"));
    expect(tsconfig.compilerOptions.strict).toBe(true);
    expect(tsconfig.compilerOptions.noUncheckedIndexedAccess).toBe(true);
    expect(tsconfig.compilerOptions.moduleResolution).toBe("bundler");
    expect(tsconfig.compilerOptions.noEmit).toBe(true);
    expect(tsconfig.include).toEqual(["src/**/*"]);
  });

  test("package.json has workspace name + framework dep", () => {
    const result = scaffoldFeature({
      name: "todoList",
      destination: join(workdir, "todoList"),
    });
    const pkg = JSON.parse(readFileSync(result.packageJsonFile, "utf8"));
    expect(pkg.name).toBe("@cosmicdrift/kumiko-sample-todo-list");
    expect(pkg.private).toBe(true);
    expect(pkg.dependencies["@cosmicdrift/kumiko-framework"]).toBe("workspace:*");
  });

  test("feature.ts starts with the schema-version header", () => {
    const result = scaffoldFeature({
      name: "todoList",
      destination: join(workdir, "todoList"),
    });
    const source = readFileSync(result.featureFile, "utf8");
    expect(source.startsWith(VERSION_HEADER)).toBe(true);
  });

  test("scaffolded feature.ts parses cleanly with no errors", () => {
    const result = scaffoldFeature({
      name: "todoList",
      destination: join(workdir, "todoList"),
    });
    const source = readFileSync(result.featureFile, "utf8");
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    const sf = project.createSourceFile("scaffolded.ts", source);
    const parsed = parseSourceFile(sf);
    expect(parsed.errors).toEqual([]);
    expect(parsed.featureName).toBe("todoList");
    expect(parsed.patterns.length).toBeGreaterThan(0);
    // Starter pattern is an entity, so the user has something to extend.
    expect(parsed.patterns[0]?.kind).toBe("entity");
  });
});

describe("scaffoldFeature — name validation", () => {
  test("rejects empty name", () => {
    expect(() => scaffoldFeature({ name: "", destination: join(workdir, "x") })).toThrow(
      /feature name is required/,
    );
  });

  test("rejects PascalCase / dashes / numbers-first", () => {
    expect(() => scaffoldFeature({ name: "TodoList", destination: join(workdir, "a") })).toThrow(
      /not a valid feature name/,
    );
    expect(() => scaffoldFeature({ name: "todo-list", destination: join(workdir, "b") })).toThrow(
      /not a valid feature name/,
    );
    expect(() => scaffoldFeature({ name: "1todo", destination: join(workdir, "c") })).toThrow(
      /not a valid feature name/,
    );
  });

  test("rejects reserved words", () => {
    expect(() => scaffoldFeature({ name: "delete", destination: join(workdir, "d") })).toThrow(
      /reserved word/,
    );
  });
});

describe("scaffoldFeature — destination handling", () => {
  test("default destination falls under repoRoot/samples/recipes/<kebab>", () => {
    const result = scaffoldFeature({ name: "todoList", repoRoot: workdir });
    expect(result.destination).toBe(join(workdir, "samples", "recipes", "todo-list"));
  });

  test("refuses to overwrite an existing destination", () => {
    const dest = join(workdir, "todoList");
    scaffoldFeature({ name: "todoList", destination: dest });
    expect(() => scaffoldFeature({ name: "todoList", destination: dest })).toThrow(
      /already exists/,
    );
  });

  test("camelCase name → kebab-case directory + package suffix", () => {
    const result = scaffoldFeature({
      name: "userProfileCustomization",
      destination: join(workdir, "userProfileCustomization"),
    });
    expect(result.packageName).toBe("@cosmicdrift/kumiko-sample-user-profile-customization");
  });
});
