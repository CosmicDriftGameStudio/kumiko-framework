// Codegen — End-to-End-Test mit realistischen Feature-Files.
//
// Schreibt Features + events.ts in ein tmp-Verzeichnis, ruft runCodegen
// auf, und prüft die generierten Files.
//
// Was hier verifiziert wird:
//   - Position-Form `r.defineEvent("name", schema)` → "imported"
//   - Object-Form `r.defineEvent({ name, schema })` → "imported"
//   - Inline-Form `r.defineEvent("name", z.object({...}))`  → "inline"
//   - Computed-Name `r.defineEvent(NAME_CONST.member, schema)` → "imported"
//     mit string-resolved Name aus dem `as const`-Object
//   - Mehrere Features in unterschiedlichen Files werden zusammengeführt
//   - Doppelte qualifiedName erzeugen Warning + werden dedupliziert
//   - Idempotent: 2× run schreibt beim 2. Mal nicht (didWrite=false)
//   - Locally-declared schema (kein import, kein inline-z.*) → Warning, skip
//   - skipped-Flag wenn 0 Events UND kein .kumiko/ schon existiert
//   - schemas.generated.ts wird erzeugt wenn inline-Schemas, sonst nicht

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodegen } from "../run-codegen";

function makeAppDir(): string {
  return mkdtempSync(join(tmpdir(), "kumiko-codegen-"));
}

function write(dir: string, relPath: string, content: string): string {
  const full = join(dir, relPath);
  const lastSep = full.lastIndexOf("/");
  mkdirSync(full.substring(0, lastSep), { recursive: true });
  writeFileSync(full, content, "utf-8");
  return full;
}

describe("runCodegen", () => {
  test("scans position-form r.defineEvent + writes augmentation", () => {
    const appRoot = makeAppDir();

    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";
export const fooSchema = z.object({ id: z.string() });
`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { fooSchema } from "./events";

export const myFeature = defineFeature("myFeat", (r) => {
  r.defineEvent("foo-happened", fooSchema);
});
`,
    );

    // handlerQns: [] opts out of the #2757 manifest-fallback warning — out of scope here.
    const result = runCodegen({ appRoot, handlerQns: [] });

    expect(result.eventCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.didWriteTypes).toBe(true);
    expect(result.didWriteDefine).toBe(true);
    expect(result.didWriteSchemas).toBe(false);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"my-feat:event:foo-happened": z.infer<typeof fooSchema>;`);
    expect(types).toContain(`import type { fooSchema }`);
    expect(types).toContain(`export {};`);

    const define = readFileSync(join(appRoot, ".kumiko", "define.ts"), "utf-8");
    expect(define).toContain(`/// <reference path="./types.generated.d.ts" />`);
    expect(define).toContain(`export function defineWriteHandler<`);
    expect(define).toContain(
      `fwDefineWriteHandler<TName, TSchema, TData, KumikoEventTypeMap>(def)`,
    );
    expect(define).toContain(`export function defineQueryHandler<`);

    expect(existsSync(join(appRoot, ".kumiko", "schemas.generated.ts"))).toBe(false);
  });

  test("scans object-form r.defineEvent", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";
export const barSchema = z.object({ count: z.number() });
`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { barSchema } from "./events";

export const myFeature = defineFeature("objForm", (r) => {
  r.defineEvent({ name: "bar-occurred", schema: barSchema });
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(1);
    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"obj-form:event:bar-occurred": z.infer<typeof barSchema>;`);
  });

  test("inline-schema becomes a generated const in schemas.generated.ts", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export const myFeature = defineFeature("inlineFeat", (r) => {
  r.defineEvent("inline-evt", z.object({ id: z.string(), count: z.number() }));
});
`,
    );

    const result = runCodegen({ appRoot, handlerQns: [] });
    expect(result.eventCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.didWriteSchemas).toBe(true);

    const schemas = readFileSync(join(appRoot, ".kumiko", "schemas.generated.ts"), "utf-8");
    expect(schemas).toContain(`import { z } from "zod";`);
    // Generated const-name is stable + qualifiedName-derived; the exact
    // string is part of the contract because types.generated.d.ts
    // imports it under that name.
    expect(schemas).toMatch(/export const _kg_inlineFeat__inlineEvt = z\.object/);
    expect(schemas).toContain(`z.object({ id: z.string(), count: z.number() })`);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(
      `"inline-feat:event:inline-evt": z.infer<typeof _kg_inlineFeat__inlineEvt>;`,
    );
    expect(types).toContain(`from "./schemas.generated"`);
  });

  test("computed name via const-member resolves to string literal", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";
export const EVT = {
  sent: "invoice-sent",
  paid: "invoice-paid",
} as const;
export const sentSchema = z.object({});
export const paidSchema = z.object({ amount: z.number() });
`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { EVT, sentSchema, paidSchema } from "./events";

export const myFeature = defineFeature("billing", (r) => {
  r.defineEvent(EVT.sent, sentSchema);
  r.defineEvent(EVT.paid, paidSchema);
});
`,
    );

    const result = runCodegen({ appRoot, handlerQns: [] });
    expect(result.eventCount).toBe(2);
    expect(result.warnings).toEqual([]);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"billing:event:invoice-sent": z.infer<typeof sentSchema>;`);
    expect(types).toContain(`"billing:event:invoice-paid": z.infer<typeof paidSchema>;`);
  });

  test("computed name + inline schema (recipes pattern)", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `export const EVT = {
  forced: "force-applied",
} as const;
`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { EVT } from "./events";

export const myFeature = defineFeature("billing", (r) => {
  r.defineEvent(EVT.forced, z.object({ reason: z.string() }));
});
`,
    );

    const result = runCodegen({ appRoot, handlerQns: [] });
    expect(result.eventCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.didWriteSchemas).toBe(true);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(
      `"billing:event:force-applied": z.infer<typeof _kg_billing__forceApplied>;`,
    );
  });

  test("merges events from multiple feature files", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/a/events.ts",
      `import { z } from "zod";\nexport const aSchema = z.object({ a: z.string() });\n`,
    );
    write(
      appRoot,
      "src/a/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { aSchema } from "./events";
export default defineFeature("featA", (r) => {
  r.defineEvent("evt", aSchema);
});
`,
    );
    write(
      appRoot,
      "src/b/events.ts",
      `import { z } from "zod";\nexport const bSchema = z.object({ b: z.number() });\n`,
    );
    write(
      appRoot,
      "src/b/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { bSchema } from "./events";
export default defineFeature("featB", (r) => {
  r.defineEvent("evt", bSchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(2);
    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"feat-a:event:evt"`);
    expect(types).toContain(`"feat-b:event:evt"`);
  });

  test("warns + dedupes on duplicate qualifiedName", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/x/events.ts",
      `import { z } from "zod";\nexport const xSchema = z.object({ id: z.string() });\nexport const ySchema = z.object({ name: z.string() });\n`,
    );
    write(
      appRoot,
      "src/x/feature1.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { xSchema } from "./events";
export default defineFeature("dup", (r) => {
  r.defineEvent("collide", xSchema);
});
`,
    );
    write(
      appRoot,
      "src/x/feature2.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { ySchema } from "./events";
export default defineFeature("dup", (r) => {
  r.defineEvent("collide", ySchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const w = result.warnings.find((w) => w.message.includes("duplicate"));
    expect(w).toBeDefined();
  });

  test("emits WriteHandlerQn union and TypedDispatcher when handlerQns passed", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";\nexport const sSchema = z.object({ id: z.string() });\n`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { sSchema } from "./events";
export default defineFeature("typed", (r) => {
  r.defineEvent("only", sSchema);
});
`,
    );

    const result = runCodegen({
      appRoot,
      handlerQns: ["typed:write:create"],
    });
    expect(result.skipped).toBe(false);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain('| "typed:write:create"');

    const define = readFileSync(join(appRoot, ".kumiko", "define.ts"), "utf-8");
    expect(define).toContain("createTypedDispatcher");
  });

  test("idempotent — second run does not re-write files", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";\nexport const sSchema = z.object({ id: z.string() });\n`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { sSchema } from "./events";
export default defineFeature("idem", (r) => {
  r.defineEvent("only", sSchema);
});
`,
    );

    const first = runCodegen({ appRoot });
    expect(first.didWriteTypes).toBe(true);
    expect(first.didWriteDefine).toBe(true);

    const second = runCodegen({ appRoot });
    expect(second.didWriteTypes).toBe(false);
    expect(second.didWriteDefine).toBe(false);
  });

  test("warns when schema is locally declared (not imported, not inline z.*)", () => {
    const appRoot = makeAppDir();
    // Schema is declared as a local const but referenced by a name that's
    // neither an imported identifier nor an inline z.* call (it's an
    // identifier-reference to the local const). Scanner can't reach it
    // without a separate scan of the file's local symbols → warn + skip.
    write(
      appRoot,
      "src/inline/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

const localSchema = z.object({ x: z.string() });

export default defineFeature("inline", (r) => {
  r.defineEvent("local", localSchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]?.message).toMatch(/not a named import nor an inline z\.\* call/);
  });

  test("skips test files, node_modules, .kumiko, dist", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";\nexport const realSchema = z.object({});\n`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { realSchema } from "./events";
export default defineFeature("real", (r) => {
  r.defineEvent("ok", realSchema);
});
`,
    );
    // Should be ignored:
    write(
      appRoot,
      "src/feature/__tests__/feature.test.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
const fakeSchema = z.object({});
defineFeature("fake-from-test", (r) => {
  r.defineEvent("nope", fakeSchema);
});
`,
    );
    write(
      appRoot,
      ".kumiko/old.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
const oldSchema = z.object({});
defineFeature("old-codegen-output", (r) => {
  r.defineEvent("nope", oldSchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(1);
    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"real:event:ok"`);
    expect(types).not.toContain(`"fake-from-test`);
    expect(types).not.toContain(`"old-codegen-output`);
  });

  test("0 events + no existing .kumiko/ → bails with skipped=true", () => {
    const appRoot = makeAppDir();
    // App with NO r.defineEvent at all. Codegen should not create an
    // empty `.kumiko/` directory.
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
export default defineFeature("nothing", (r) => {
  r.requires("auth");
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.didWriteTypes).toBe(false);
    expect(result.didWriteDefine).toBe(false);
    expect(existsSync(join(appRoot, ".kumiko"))).toBe(false);
  });

  test("schemas.generated.ts gets removed when last inline-schema disappears", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
export default defineFeature("evolve", (r) => {
  r.defineEvent("inline-once", z.object({ x: z.string() }));
});
`,
    );

    const first = runCodegen({ appRoot });
    expect(first.didWriteSchemas).toBe(true);
    expect(existsSync(join(appRoot, ".kumiko", "schemas.generated.ts"))).toBe(true);

    // Refactor: schema moves out of the call-site into a named export.
    write(
      appRoot,
      "src/feature/events.ts",
      `import { z } from "zod";\nexport const onceSchema = z.object({ x: z.string() });\n`,
    );
    write(
      appRoot,
      "src/feature/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { onceSchema } from "./events";
export default defineFeature("evolve", (r) => {
  r.defineEvent("inline-once", onceSchema);
});
`,
    );

    const second = runCodegen({ appRoot });
    expect(second.didWriteSchemas).toBe(true); // means: removed
    expect(existsSync(join(appRoot, ".kumiko", "schemas.generated.ts"))).toBe(false);
  });

  test(".kumiko/package.json has the shape that yarn 4 link: needs", () => {
    // The generated package.json turns `.kumiko/` into an installable
    // file-link package (`"@app/define": "link:./.kumiko"` in app's
    // package.json). The shape here is load-bearing:
    //   - name=@app/define matches what handlers import
    //   - exports."."=./define.ts gives the wrapper as the default
    //   - exports."./*"=./* lets apps reach types.generated etc.
    //   - license=BUSL-1.1 keeps License-Check happy (UNLICENSED would deny)
    //   - main+types pin TypeScript + Node resolution targets
    // Regressions in any field break either runtime resolution or the
    // kumiko-check License-Check gate — the test fails fast.
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/feature.ts",
      `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
export default defineFeature("pkgjson", (r) => {
  r.defineEvent("evt", z.object({ id: z.string() }));
});
`,
    );

    runCodegen({ appRoot });

    const pkgPath = join(appRoot, ".kumiko", "package.json");
    expect(existsSync(pkgPath)).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<string, unknown>;
    expect(pkg).toMatchObject({
      name: "@app/define",
      private: true,
      license: "BUSL-1.1",
      type: "module",
      main: "./define.ts",
      types: "./define.ts",
      exports: {
        ".": "./define.ts",
        "./*": "./*",
      },
    });
  });

  // #2757 — `kumiko-build` runs `runCodegen({ appRoot })` with no
  // `handlerQns`. Without a `feature-manifest.json` that falls back to
  // an empty list, which used to mean "render types.generated.d.ts and
  // define.ts as if there were no write handlers at all" — silently
  // deleting an already-checked-in WriteHandlerQn union / TypedDispatcher
  // that a previous dev-server run had generated from the real registry.
  describe("preserving the handler-derived block when handlerQns is omitted (#2757)", () => {
    function writeSingleEventFeature(appRoot: string): void {
      write(
        appRoot,
        "src/feature/events.ts",
        `import { z } from "zod";\nexport const sSchema = z.object({ id: z.string() });\n`,
      );
      write(
        appRoot,
        "src/feature/feature.ts",
        `import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { sSchema } from "./events";
export default defineFeature("app", (r) => {
  r.defineEvent("only", sSchema);
});
`,
      );
    }

    test("a block generated with handlerQns survives a later run without handlerQns", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);

      runCodegen({ appRoot, handlerQns: ["app:write:create"] });
      const typesPath = join(appRoot, ".kumiko", "types.generated.d.ts");
      const definePath = join(appRoot, ".kumiko", "define.ts");
      expect(readFileSync(typesPath, "utf-8")).toContain('| "app:write:create"');
      expect(readFileSync(definePath, "utf-8")).toContain("createTypedDispatcher");

      // No feature-manifest.json in appRoot — this is the kumiko-build path.
      const result = runCodegen({ appRoot });

      expect(readFileSync(typesPath, "utf-8")).toContain('| "app:write:create"');
      expect(readFileSync(definePath, "utf-8")).toContain("createTypedDispatcher");
      expect(result.warnings.some((w) => w.message.includes("feature-manifest.json"))).toBe(true);
      // Round-trip is byte-identical, not just "still contains the QN" — writeIfChanged
      // must see no diff once the preserved block is reattached.
      expect(result.didWriteTypes).toBe(false);
      expect(result.didWriteDefine).toBe(false);
    });

    test("a block from a pre-#2757 file (no marker) survives a run without handlerQns", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);
      // Legacy shape: what the released renderer wrote before markers existed.
      write(
        appRoot,
        ".kumiko/types.generated.d.ts",
        `export {};\n\nexport type WriteHandlerQn =\n  | "app:write:legacy"\n;\n`,
      );
      write(
        appRoot,
        ".kumiko/define.ts",
        `export function defineQueryHandler() {}\n\nimport type { Dispatcher, WriteOpts, WriteResult } from "@cosmicdrift/kumiko-headless";\nexport function createTypedDispatcher() {}\n`,
      );

      const result = runCodegen({ appRoot });

      expect(readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8")).toContain(
        '| "app:write:legacy"',
      );
      expect(readFileSync(join(appRoot, ".kumiko", "define.ts"), "utf-8")).toContain(
        "createTypedDispatcher",
      );
      expect(result.warnings.some((w) => w.message.includes("feature-manifest.json"))).toBe(true);
    });

    test("no handlerQns and no prior generated file → no block, no crash", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);

      const result = runCodegen({ appRoot });

      const typesPath = join(appRoot, ".kumiko", "types.generated.d.ts");
      const definePath = join(appRoot, ".kumiko", "define.ts");
      expect(readFileSync(typesPath, "utf-8")).not.toContain("WriteHandlerQn");
      expect(readFileSync(definePath, "utf-8")).not.toContain("TypedDispatcher");
      expect(result.skipped).toBe(false);
    });

    test("a preserved block is not duplicated across repeated runs without handlerQns", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);

      runCodegen({ appRoot, handlerQns: ["app:write:create"] });
      runCodegen({ appRoot });
      runCodegen({ appRoot });

      const typesPath = join(appRoot, ".kumiko", "types.generated.d.ts");
      const definePath = join(appRoot, ".kumiko", "define.ts");
      const typesOccurrences =
        readFileSync(typesPath, "utf-8").split("app:write:create").length - 1;
      const defineOccurrences =
        readFileSync(definePath, "utf-8").split("createTypedDispatcher").length - 1;
      expect(typesOccurrences).toBe(1);
      expect(defineOccurrences).toBe(1);
    });

    test("a later run with handlerQns overwrites a preserved stale block", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);

      runCodegen({ appRoot, handlerQns: ["app:write:create"] });
      runCodegen({ appRoot }); // preserves app:write:create
      runCodegen({ appRoot, handlerQns: ["app:write:update"] });

      const typesPath = join(appRoot, ".kumiko", "types.generated.d.ts");
      const typesContent = readFileSync(typesPath, "utf-8");
      expect(typesContent).toContain('| "app:write:update"');
      expect(typesContent).not.toContain("app:write:create");
    });

    test("the missing-manifest warning appears only when handlerQns is omitted", () => {
      const appRoot = makeAppDir();
      writeSingleEventFeature(appRoot);

      const withoutOption = runCodegen({ appRoot });
      expect(withoutOption.warnings.some((w) => w.message.includes("feature-manifest.json"))).toBe(
        true,
      );

      const explicitEmpty = runCodegen({ appRoot, handlerQns: [] });
      expect(explicitEmpty.warnings.some((w) => w.message.includes("feature-manifest.json"))).toBe(
        false,
      );

      const explicitList = runCodegen({ appRoot, handlerQns: ["app:write:create"] });
      expect(explicitList.warnings.some((w) => w.message.includes("feature-manifest.json"))).toBe(
        false,
      );
    });
  });
});
