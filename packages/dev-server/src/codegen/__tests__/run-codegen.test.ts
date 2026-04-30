// Codegen — End-to-End-Test mit einem realistischen Feature-File.
//
// Schreibt ein feature + sein events.ts in ein tmp-Verzeichnis, ruft
// runCodegen auf, und prüft beide Output-Files.
//
// Wichtige Garantien die hier verifiziert werden:
//   - Position-Form `r.defineEvent("name", schema)` wird erkannt
//   - Object-Form `r.defineEvent({ name, schema })` wird erkannt
//   - Mehrere Features in unterschiedlichen Files werden zusammengeführt
//   - Doppelte qualifiedName erzeugen Warning + werden dedupliziert
//   - Idempotent: 2× run schreibt beim 2. Mal nicht (didWrite=false)
//   - Schemas in derselben Datei (kein import) → Warning, übersprungen

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
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
      `import { defineFeature } from "@kumiko/framework/engine";
import { fooSchema } from "./events";

export const myFeature = defineFeature("myFeat", (r) => {
  r.defineEvent("foo-happened", fooSchema);
});
`,
    );

    const result = runCodegen({ appRoot });

    expect(result.eventCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.didWriteTypes).toBe(true);
    expect(result.didWriteDefine).toBe(true);

    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"myFeat:event:foo-happened": z.infer<typeof fooSchema>;`);
    expect(types).toContain(`import type { fooSchema }`);
    expect(types).toContain(`export {};`);

    const define = readFileSync(join(appRoot, ".kumiko", "define.ts"), "utf-8");
    expect(define).toContain(`import "./types.generated";`);
    expect(define).toContain(`export function defineWriteHandler<`);
    expect(define).toContain(`fwDefineWriteHandler<TName, TSchema, TData, KumikoEventTypeMap>(def)`);
    expect(define).toContain(`export function defineQueryHandler<`);
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
      `import { defineFeature } from "@kumiko/framework/engine";
import { barSchema } from "./events";

export const myFeature = defineFeature("objForm", (r) => {
  r.defineEvent({ name: "bar-occurred", schema: barSchema });
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(1);
    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"objForm:event:bar-occurred": z.infer<typeof barSchema>;`);
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
      `import { defineFeature } from "@kumiko/framework/engine";
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
      `import { defineFeature } from "@kumiko/framework/engine";
import { bSchema } from "./events";
export default defineFeature("featB", (r) => {
  r.defineEvent("evt", bSchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(2);
    const types = readFileSync(join(appRoot, ".kumiko", "types.generated.d.ts"), "utf-8");
    expect(types).toContain(`"featA:event:evt"`);
    expect(types).toContain(`"featB:event:evt"`);
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
      `import { defineFeature } from "@kumiko/framework/engine";
import { xSchema } from "./events";
export default defineFeature("dup", (r) => {
  r.defineEvent("collide", xSchema);
});
`,
    );
    write(
      appRoot,
      "src/x/feature2.ts",
      `import { defineFeature } from "@kumiko/framework/engine";
import { ySchema } from "./events";
export default defineFeature("dup", (r) => {
  r.defineEvent("collide", ySchema);
});
`,
    );

    const result = runCodegen({ appRoot });
    expect(result.eventCount).toBe(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    const w = result.warnings.find((w) => w.reason.includes("duplicate"));
    expect(w).toBeDefined();
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
      `import { defineFeature } from "@kumiko/framework/engine";
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

  test("warns when schema is locally declared (no import)", () => {
    const appRoot = makeAppDir();
    write(
      appRoot,
      "src/inline/feature.ts",
      `import { defineFeature } from "@kumiko/framework/engine";
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
    expect(result.warnings[0]?.reason).toMatch(/not found via named import/);
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
      `import { defineFeature } from "@kumiko/framework/engine";
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
      `import { defineFeature } from "@kumiko/framework/engine";
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
      `import { defineFeature } from "@kumiko/framework/engine";
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
});
