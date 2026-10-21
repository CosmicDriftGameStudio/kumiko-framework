import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli.ts";

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

describe("runSchemaCli validate — VALIDATE_BOOT_OPTIONS export", () => {
  let appCwd: string;
  beforeEach(() => {
    appCwd = mkdtempSync(join(tmpdir(), "kumiko-schema-cli-boot-options-"));
    mkdirSync(join(appCwd, "kumiko"), { recursive: true });
  });
  afterEach(() => {
    rmSync(appCwd, { recursive: true, force: true });
  });

  // `orphan` is a nav whose screen no allowlisted nav entry reaches.
  function writeNavFixture(appCwd: string, optionsExport: string): void {
    const engineSrc = join(import.meta.dir, "../engine/index.ts");
    const fixtureSrc = join(
      import.meta.dir,
      "../../../testing/src/helpers/boot-validator-fixture.ts",
    );
    const zodSrc = Bun.resolveSync("zod", import.meta.dir);
    writeFileSync(
      join(appCwd, "kumiko/schema.ts"),
      `import * as z from "${zodSrc}";
import { createEntity, createTextField, defineFeature } from "${engineSrc}";
import { withBootValidatorFixture } from "${fixtureSrc}";
export const ENTITY_METAS = [
{ tableName: "read_widgets", source: "unmanaged", indexes: [],
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true, defaultSql: "gen_random_uuid()" }] },
];
export const FEATURES = withBootValidatorFixture([
defineFeature("shop", (r) => {
  r.entity({
    name: "item",
    ...createEntity({ fields: { title: createTextField({ personal: false, reason: "test_fixture" }) } }),
  });
  r.queryHandler({
    name: "item:list",
    schema: z.object({}),
    handler: async () => ({ rows: [], nextCursor: null }),
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.screen({ id: "item-list", type: "entityList", entity: "item", columns: ["title"] });
  r.screen({ id: "orphan-list", type: "entityList", entity: "item", columns: ["title"] });
  r.nav({ id: "items", label: "Items", screen: "shop:screen:item-list" });
  r.nav({ id: "orphan", label: "Orphan", screen: "shop:screen:orphan-list" });
}),
]);
${optionsExport}
`,
    );
  }

  async function validateWithWarnings(): Promise<{
    code: number;
    cap: ReturnType<typeof captureOut>;
    unreachableWarnings: string[];
  }> {
    await runSchemaCli(["generate", "init"], appCwd, captureOut().out);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cap = captureOut();
      const code = await runSchemaCli(["validate"], appCwd, cap.out);
      const unreachableWarnings = warnSpy.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes("unreachable"));
      return { code, cap, unreachableWarnings };
    } finally {
      warnSpy.mockRestore();
    }
  }

  test("an explicit navAllowlist without an exemption warns for the unreachable nav", async () => {
    writeNavFixture(
      appCwd,
      `export const VALIDATE_BOOT_OPTIONS = { navAllowlist: new Set(["shop:nav:items"]) };`,
    );
    const { code, unreachableWarnings } = await validateWithWarnings();
    expect(code).toBe(0);
    expect(unreachableWarnings).toHaveLength(1);
    expect(unreachableWarnings[0]).toContain("shop:nav:orphan");
  });

  test("navAllowlistExempt from VALIDATE_BOOT_OPTIONS silences that warning", async () => {
    writeNavFixture(
      appCwd,
      `export const VALIDATE_BOOT_OPTIONS = {
navAllowlist: new Set(["shop:nav:items"]),
navAllowlistExempt: new Set(["shop:nav:orphan"]),
};`,
    );
    const { code, cap, unreachableWarnings } = await validateWithWarnings();
    expect(code).toBe(0);
    expect(unreachableWarnings).toHaveLength(0);
    expect(cap.log.join("\n")).toContain("feature configuration is valid");
  });

  test("an undefined VALIDATE_BOOT_OPTIONS (config without validateBootOptions) means no options", async () => {
    writeNavFixture(appCwd, `export const VALIDATE_BOOT_OPTIONS = undefined;`);
    const { code, unreachableWarnings } = await validateWithWarnings();
    expect(code).toBe(0);
    expect(unreachableWarnings).toHaveLength(0);
  });

  test("runner-injected options (env, entityFieldCipher) are ignored, not rejected", async () => {
    writeNavFixture(
      appCwd,
      `export const VALIDATE_BOOT_OPTIONS = { env: {}, warnOnUniqueAccessRoles: false };`,
    );
    const { code } = await validateWithWarnings();
    expect(code).toBe(0);
  });

  test("requiredLocales from VALIDATE_BOOT_OPTIONS is honoured", async () => {
    writeNavFixture(appCwd, `export const VALIDATE_BOOT_OPTIONS = { requiredLocales: ["en"] };`);
    await runSchemaCli(["generate", "init"], appCwd, captureOut().out);
    const cap = captureOut();
    const code = await runSchemaCli(["validate"], appCwd, cap.out);
    expect(code).toBe(0);
  });

  test.each([
    ["a non-object", `export const VALIDATE_BOOT_OPTIONS = "nope";`, "must be an object"],
    [
      "an array navAllowlist",
      `export const VALIDATE_BOOT_OPTIONS = { navAllowlist: ["shop:nav:items"] };`,
      "`navAllowlist` must be a Set<string>",
    ],
    [
      "a Set with non-string entries",
      `export const VALIDATE_BOOT_OPTIONS = { navAllowlistExempt: new Set([1]) };`,
      "`navAllowlistExempt` must be a Set<string>",
    ],
    [
      "a non-boolean warnOnUniqueAccessRoles",
      `export const VALIDATE_BOOT_OPTIONS = { warnOnUniqueAccessRoles: "yes" };`,
      "`warnOnUniqueAccessRoles` must be a boolean",
    ],
    [
      "requiredLocales with an empty string",
      `export const VALIDATE_BOOT_OPTIONS = { requiredLocales: ["en", ""] };`,
      "`requiredLocales` must be an array of non-empty strings",
    ],
  ])("%s fails the boot step with a clear message", async (_label, optionsExport, expected) => {
    writeNavFixture(appCwd, optionsExport);
    const { code, cap } = await validateWithWarnings();
    expect(code).toBe(1);
    const err = cap.err.join("\n");
    expect(err).toContain("boot:");
    expect(err).toContain("VALIDATE_BOOT_OPTIONS");
    expect(err).toContain(expected);
  });
});
