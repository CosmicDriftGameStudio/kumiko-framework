import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAppCustomScreenWriteQns } from "../boot-validator/custom-screen-write-qns";

describe("validateAppCustomScreenWriteQns", () => {
  test("throws on unknown dispatcher.write QN in app src", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "kumiko-boot-qns-"));
    const srcDir = join(appRoot, "src", "screens");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "list.tsx"),
      `export function List() {
        return null;
      }
      async function onDelete(dispatcher: { write: (t: string, p: unknown) => Promise<unknown> }) {
        await dispatcher.write("shop:write:ghost-delete", { id: "1" });
      }
      `,
      "utf-8",
    );

    const known = new Set(["shop:write:item:delete"]);
    expect(() => validateAppCustomScreenWriteQns(appRoot, known)).toThrow(
      /shop:write:ghost-delete/,
    );
  });

  test("passes when QN is registered", () => {
    const appRoot = mkdtempSync(join(tmpdir(), "kumiko-boot-qns-"));
    const srcDir = join(appRoot, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "screen.tsx"),
      `await dispatcher.write("shop:write:item:delete", { id: "1" });`,
      "utf-8",
    );

    const known = new Set(["shop:write:item:delete"]);
    expect(() => validateAppCustomScreenWriteQns(appRoot, known)).not.toThrow();
  });
});
