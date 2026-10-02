import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import {
  findImportBindingForLocalName,
  resolveExportedVariable,
  resolveModuleFile,
} from "../extractors/resolve-import.js";
import { resolveSameFileObjectLiteral } from "../extractors/shared.js";
import { parseFeatureFile, parseSourceFile } from "../parse.js";

function loadFixture(relPath: string): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  return project.addSourceFileAtPath(resolve(__dirname, relPath));
}

describe("resolveModuleFile", () => {
  test("resolves a relative specifier to the real source file", () => {
    const entry = loadFixture("fixtures/resolve-import/entry.ts");
    const resolved = resolveModuleFile(entry, "./star-barrel");
    expect(String(resolved?.getFilePath())).toBe(
      resolve(__dirname, "fixtures/resolve-import/star-barrel.ts"),
    );
  });

  test("returns undefined for an unresolvable package", () => {
    const entry = loadFixture("fixtures/resolve-import/entry.ts");
    const resolved = resolveModuleFile(entry, "@totally-unresolvable/not-a-real-package");
    expect(resolved).toBeUndefined();
  });
});

describe("findImportBindingForLocalName", () => {
  test("follows an aliased named import to the module's original export name", () => {
    const entry = loadFixture("fixtures/resolve-import/entry.ts");
    const binding = findImportBindingForLocalName(entry, "RENAMED");
    expect(binding).toEqual({ moduleSpecifier: "./star-barrel", importedName: "ALIASED" });
  });

  test("returns undefined for a name with no import declaration", () => {
    const entry = loadFixture("fixtures/resolve-import/entry.ts");
    expect(findImportBindingForLocalName(entry, "NOT_IMPORTED")).toBeUndefined();
  });
});

describe("resolveExportedVariable", () => {
  test("follows a cross-file aliased re-export (export { X as Y } from ...)", () => {
    const aliasFile = loadFixture("fixtures/resolve-import/alias-reexport.ts");
    const decl = resolveExportedVariable(aliasFile, "ALIASED");
    expect(decl?.getName()).toBe("ORIGIN_VALUE");
    expect(decl?.getInitializer()?.getText()).toContain("origin-value");
  });

  test("follows an export * barrel to a nested aliased re-export", () => {
    const barrelFile = loadFixture("fixtures/resolve-import/star-barrel.ts");
    const decl = resolveExportedVariable(barrelFile, "ALIASED");
    expect(decl?.getName()).toBe("ORIGIN_VALUE");
  });

  test("follows a local re-export of an imported binding (import + export {} with no from)", () => {
    const localRebindFile = loadFixture("fixtures/resolve-import/local-rebind.ts");
    const decl = resolveExportedVariable(localRebindFile, "LOCAL_EXPORT");
    expect(decl?.getName()).toBe("ORIGIN_VALUE");
    expect(String(decl?.getSourceFile().getFilePath())).toBe(
      resolve(__dirname, "fixtures/resolve-import/origin.ts"),
    );
  });

  test("terminates instead of looping forever on a mutual export * cycle", () => {
    const cycleFile = loadFixture("fixtures/resolve-import/cycle-a.ts");
    const decl = resolveExportedVariable(cycleFile, "NOTHING_EXPORTED_HERE");
    expect(decl).toBeUndefined();
  });

  test("returns undefined for a name that is never exported anywhere in the chain", () => {
    const barrelFile = loadFixture("fixtures/resolve-import/star-barrel.ts");
    expect(resolveExportedVariable(barrelFile, "DOES_NOT_EXIST")).toBeUndefined();
  });
});

describe("same-file shadowing (regression for the getSymbol()/getDefinitionNodes() removal)", () => {
  function makeSourceFile(content: string): SourceFile {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    return project.createSourceFile("shadow.ts", content);
  }

  test("an inner const declared inside setup() shadows a same-named outer const", () => {
    const sf = makeSourceFile(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const NAME = "outer";

defineFeature("f", (r) => {
  const NAME = "inner";
  r.extendsRegistrar(NAME, {});
});
`);
    const result = parseSourceFile(sf);
    expect(result.errors).toEqual([]);
    expect(result.patterns).toMatchObject([{ kind: "extendsRegistrar", extensionName: "inner" }]);
  });

  test("a function parameter shadowing an outer const yields an unresolvable reference, not the outer value", () => {
    const sf = makeSourceFile(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const NAME = "outer";

defineFeature("f", (r) => {
  function wrap(NAME) {
    r.extendsRegistrar(NAME, {});
  }
  wrap("shadowed-by-param");
});
`);
    const result = parseSourceFile(sf);
    expect(result.patterns).toEqual([]);
    expect(result.errors).toEqual([expect.objectContaining({ methodName: "extendsRegistrar" })]);
  });

  const shadowingBodies: ReadonlyArray<readonly [string, string]> = [
    [
      "a destructured parameter",
      "const run = ({ NAME }) => { r.extendsRegistrar(NAME, {}); };\n  run({ NAME: 'x' });",
    ],
    [
      "a destructured local const",
      "const { NAME } = { NAME: 'x' };\n  r.extendsRegistrar(NAME, {});",
    ],
    ["an array-destructured local const", "const [NAME] = ['x'];\n  r.extendsRegistrar(NAME, {});"],
    ["a for...of variable", "for (const NAME of ['x']) { r.extendsRegistrar(NAME, {}); }"],
    ["a for...in variable", "for (const NAME in { x: 1 }) { r.extendsRegistrar(NAME, {}); }"],
    ["a classic for variable", "for (let NAME = 'x'; ; ) { r.extendsRegistrar(NAME, {}); break; }"],
    ["a catch variable", "try { throw 1; } catch (NAME) { r.extendsRegistrar(NAME, {}); }"],
    ["a method parameter", "const o = { m(NAME) { r.extendsRegistrar(NAME, {}); } };\n  o.m('x');"],
    [
      "a constructor parameter",
      "class C { constructor(NAME) { r.extendsRegistrar(NAME, {}); } }\n  new C('x');",
    ],
    [
      "an accessor parameter",
      "const o = { set v(NAME) { r.extendsRegistrar(NAME, {}); } };\n  o.v = 'x';",
    ],
  ];

  for (const [label, body] of shadowingBodies) {
    test(`${label} shadows an outer const instead of resolving to it`, () => {
      const sf = makeSourceFile(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const NAME = "outer";

defineFeature("f", (r) => {
  ${body}
});
`);
      const result = parseSourceFile(sf);
      expect(result.patterns).toEqual([]);
      expect(result.errors).toEqual([expect.objectContaining({ methodName: "extendsRegistrar" })]);
    });
  }
});

describe("resolveSameFileObjectLiteral", () => {
  test("does not follow an imported binding into another file", () => {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    project.createSourceFile("config.ts", "export const CONFIG = { a: 1 };");
    const sf = project.createSourceFile(
      "use.ts",
      'import { CONFIG } from "./config";\nconst x = CONFIG;\n',
    );
    const reference = sf.getVariableDeclarationOrThrow("x").getInitializerOrThrow();
    expect(resolveSameFileObjectLiteral(reference)).toBeUndefined();
  });

  test("resolves a same-file const to its object literal", () => {
    const project = new Project({
      skipAddingFilesFromTsConfig: true,
      skipFileDependencyResolution: true,
      useInMemoryFileSystem: true,
    });
    const sf = project.createSourceFile("use.ts", "const CONFIG = { a: 1 };\nconst x = CONFIG;\n");
    const reference = sf.getVariableDeclarationOrThrow("x").getInitializerOrThrow();
    expect(resolveSameFileObjectLiteral(reference)?.getText()).toBe("{ a: 1 }");
  });
});

describe("parseFeatureFile resolves cross-file constants without a Program", () => {
  test("an event-name constant imported through an alias + export-star chain and an aliased registrar wrapper both resolve", () => {
    const result = parseFeatureFile(
      resolve(__dirname, "fixtures/cross-file-alias-chain/feature.ts"),
    );
    expect(result.errors).toEqual([]);
    expect(result.patterns.map((p) => p.kind)).toEqual(["defineEvent", "nav"]);
    expect(result.patterns[0]).toMatchObject({ eventName: "session-revoked" });
    expect(result.patterns[1]).toMatchObject({ kind: "nav", definition: { id: "aliased" } });
  });
});
