import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Project, type SourceFile } from "ts-morph";
import {
  findImportBindingForLocalName,
  resolveExportedVariable,
  resolveModuleFile,
} from "../extractors/resolve-import";
import { parseFeatureFile, parseSourceFile } from "../parse";

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
});

describe("parseFeatureFile resolves cross-file constants without a Program", () => {
  test("sessions' imported event-name constant resolves to its real value", () => {
    const result = parseFeatureFile(
      resolve(__dirname, "../../../../../bundled-features/src/sessions/feature.ts"),
    );
    const defineEvent = result.patterns.find((p) => p.kind === "defineEvent");
    // SESSION_REVOKED_EVENT_SHORT is imported from ./session-revoked-event —
    // only resolves through the cross-file resolver this change replaces.
    expect(defineEvent).toMatchObject({ eventName: "session-revoked" });
  });
});
