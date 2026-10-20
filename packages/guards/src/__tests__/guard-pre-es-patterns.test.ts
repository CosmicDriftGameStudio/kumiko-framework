import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { guard } from "../guard-pre-es-patterns";

function violationsFor(source: string): string[] {
  const project = new Project({ skipAddingFilesFromTsConfig: true, useInMemoryFileSystem: true });
  const sf = project.createSourceFile(`${process.cwd()}/packages/framework/src/x.ts`, source);
  return guard.run([sf], []).violations.map((v) => v.message);
}

describe("Pre-ES-Patterns Guard", () => {
  test("flags createEventLog used as an identifier", () => {
    expect(violationsFor("declare const createEventLog: () => void;\ncreateEventLog();")).toEqual([
      expect.stringContaining("[createEventLog]"),
      expect.stringContaining("[createEventLog]"),
    ]);
  });

  test("ignores the name inside a comment or a string literal", () => {
    expect(
      violationsFor('// createEventLog was removed\nexport const s = "createEventLog";'),
    ).toEqual([]);
  });

  test("flags the configChanges string literal but not a longer literal containing it", () => {
    expect(violationsFor('export const a = "configChanges";')).toHaveLength(1);
    expect(violationsFor('export const a = "configChangesX";')).toEqual([]);
  });

  test("flags r.postEvent( calls but not a plain property read", () => {
    expect(violationsFor("declare const r: any;\nr.postEvent({});")).toHaveLength(1);
    expect(violationsFor("declare const r: any;\nexport const p = r.postEvent;")).toEqual([]);
  });

  test("a file without any anchor name has no findings", () => {
    expect(violationsFor("export const a = 1;")).toEqual([]);
  });
});
