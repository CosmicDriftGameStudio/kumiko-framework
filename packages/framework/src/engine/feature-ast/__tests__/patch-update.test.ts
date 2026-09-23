// `updatePattern`/`op: "update"` tests: a header-field-only edit must leave
// schemaSource/handlerBody/comments and every unnamed field byte-identical.

import { describe, expect, test } from "bun:test";
import { Project, type SourceFile } from "ts-morph";
import { parseSourceFile } from "../parse";
import { applyChanges, type HandlerHeaderUpdate, updatePattern } from "../patch";

let fileCounter = 0;

function makeSourceFile(content: string): SourceFile {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    useInMemoryFileSystem: true,
  });
  fileCounter++;
  return project.createSourceFile(`f-${fileCounter}.ts`, content);
}

function syntaxErrors(sf: SourceFile): readonly string[] {
  return sf
    .getProject()
    .getProgram()
    .getSyntacticDiagnostics(sf)
    .map((d) => d.getMessageText().toString());
}

describe("updatePattern — writeHandler", () => {
  test("F11: set access, schema/handler body byte-identical, no diagnostics", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { access: { roles: ["TenantAdmin"] } },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { roles: ["TenantAdmin"] },
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);

    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    const pattern = reparsed.patterns.find((p) => p.kind === "writeHandler");
    expect(pattern).toMatchObject({ access: { roles: ["TenantAdmin"] } });
    expect(pattern?.kind).toBe("writeHandler");
    if (pattern?.kind !== "writeHandler") throw new Error("expected a writeHandler pattern");
    expect(pattern.schemaSource?.raw).toBe("z.object({})");
    expect(pattern.handlerBody?.raw).toBe("async () => {}");
  });

  test("rateLimit update leaves a non-literal `access: ADMIN` and its trailing comment untouched", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const ADMIN = { roles: ["Admin"] };

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:archive",
    schema: z.object({}),
    handler: async () => {},
    access: ADMIN, // legacy role set
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:archive" },
      set: { rateLimit: { per: "user", limit: 10, windowSeconds: 120 } },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const ADMIN = { roles: ["Admin"] };

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:archive",
    schema: z.object({}),
    handler: async () => {},
    access: ADMIN, // legacy role set
    rateLimit: { per: "user", limit: 10, windowSeconds: 120 },
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("appends a missing property (description) after the last existing property", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "Creates an item" },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    description: "Creates an item",
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("shorthand `{ ..., rateLimit }` becomes `rateLimit: {...}`", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const rateLimit = { per: "user", limit: 5, windowSeconds: 60 };

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    rateLimit,
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { rateLimit: { per: "tenant", limit: 20, windowSeconds: 300 } },
    };
    updatePattern(sf, change);

    expect(sf.getFullText()).toContain(
      '    rateLimit: { per: "tenant", limit: 20, windowSeconds: 300 },',
    );
    expect(sf.getFullText()).not.toMatch(/\n\s*rateLimit,\n/);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("a long value that wraps multi-line is indented at the property's own column", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: {
        access: {
          roles: [
            "TenantAdmin",
            "TenantBillingManager",
            "TenantSupportAgent",
            "TenantComplianceReviewer",
          ],
        },
      },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: {
      roles: [
        "TenantAdmin",
        "TenantBillingManager",
        "TenantSupportAgent",
        "TenantComplianceReviewer",
      ],
    },
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("appending after a property with a trailing comment keeps the comment on its own property's line", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } }, // legacy access rule
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "Creates an item" },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } }, // legacy access rule
    description: "Creates an item",
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("unset on a single-line literal removes only the target property, not the whole call", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({ name: "item:create", schema: z.object({}), handler: async () => {}, access: { openToAll: { reason: "test" } }, description: "old" });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: {},
      unset: ["description"],
    };
    updatePattern(sf, change);

    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    const pattern = reparsed.patterns.find((p) => p.kind === "writeHandler");
    expect(pattern).toMatchObject({ handlerName: "item:create" });
    expect(pattern?.kind).toBe("writeHandler");
    if (pattern?.kind !== "writeHandler") throw new Error("expected a writeHandler pattern");
    expect(pattern.description).toBeUndefined();
    expect(pattern.schemaSource?.raw).toBe("z.object({})");
    expect(pattern.handlerBody?.raw).toBe("async () => {}");
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("unset removes the property line and its comma; unsetting a missing key is a no-op", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: {},
      unset: ["rateLimit", "description"],
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("a duplicate key in `unset` does not corrupt code after the handler call", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });

  r.metric({ name: "created", type: "counter" });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: {},
      unset: ["rateLimit", "rateLimit"],
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });

  r.metric({ name: "created", type: "counter" });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("a key present in both set and unset throws", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { rateLimit: { per: "tenant", limit: 1, windowSeconds: 1 } },
      unset: ["rateLimit"],
    };
    expect(() => updatePattern(sf, change)).toThrow(/is in both set and unset/);
  });

  test("appending after a value with no trailing comma but a trailing comment inserts the comma before the comment", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } } // no trailing comma, trailing comment
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "Creates an item" },
    };
    updatePattern(sf, change);

    const expected = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } }, // no trailing comma, trailing comment
    description: "Creates an item",
  });
});
`;
    expect(sf.getFullText()).toBe(expected);
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("appending after a last property sharing its line with the closing `});` throws", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } } });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "Creates an item" },
    };
    expect(() => updatePattern(sf, change)).toThrow(/shares a line with other code/);
  });

  test("two set keys + one unset key in a single change apply correctly (node invalidation)", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
    description: "old description",
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: {
        access: { roles: ["TenantAdmin"] },
        description: "new description",
      },
      unset: ["rateLimit"],
    };
    updatePattern(sf, change);

    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    const pattern = reparsed.patterns.find((p) => p.kind === "writeHandler");
    expect(pattern).toMatchObject({
      access: { roles: ["TenantAdmin"] },
      description: "new description",
    });
    expect(pattern?.kind).toBe("writeHandler");
    if (pattern?.kind !== "writeHandler") throw new Error("expected a writeHandler pattern");
    expect(pattern.rateLimit).toBeUndefined();
    expect(pattern.schemaSource?.raw).toBe("z.object({})");
    expect(pattern.handlerBody?.raw).toBe("async () => {}");
    expect(syntaxErrors(sf)).toEqual([]);
  });
});

describe("updatePattern — queryHandler / streamHandler", () => {
  test("queryHandler: set description", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.queryHandler({
    name: "item:get",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "queryHandler", handlerName: "item:get" },
      set: { description: "Fetches an item" },
    };
    updatePattern(sf, change);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.patterns.find((p) => p.kind === "queryHandler")).toMatchObject({
      description: "Fetches an item",
    });
    expect(syntaxErrors(sf)).toEqual([]);
  });

  test("streamHandler: set rateLimit", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.streamHandler({
    name: "item:watch",
    schema: z.object({}),
    handler: async function* () {},
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "streamHandler", handlerName: "item:watch" },
      set: { rateLimit: { per: "ip", limit: 3, windowSeconds: 10 } },
    };
    updatePattern(sf, change);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.patterns.find((p) => p.kind === "streamHandler")).toMatchObject({
      rateLimit: { per: "ip", limit: 3, windowSeconds: 10 },
    });
    expect(syntaxErrors(sf)).toEqual([]);
  });
});

describe("updatePattern — runtime throws", () => {
  const OBJECT_FORM = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`;

  test("id not found", () => {
    const sf = makeSourceFile(OBJECT_FORM);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "ghost" },
      set: { description: "x" },
    };
    expect(() => updatePattern(sf, change)).toThrow(/no call found/);
  });

  test("positional call form is rejected", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler("item:create", z.object({}), async () => {}, {
    access: { openToAll: { reason: "test" } },
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "x" },
    };
    expect(() => updatePattern(sf, change)).toThrow(/positional call form.*use replace/);
  });

  test("opaque handler reference (imported binding) is rejected", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { importedHandler } from "./handlers";

defineFeature("inventory", (r) => {
  r.writeHandler(importedHandler);
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "x" },
    };
    // findCallForId can't match an opaque reference by handlerName either —
    // both failure modes report "no call found" since the id can never be
    // derived from an unresolved identifier.
    expect(() => updatePattern(sf, change)).toThrow(/no call found/);
  });

  test("a single non-object argument is rejected as not an inline object literal", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler("item:create");
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "x" },
    };
    expect(() => updatePattern(sf, change)).toThrow(/not an inline object literal.*use replace/);
  });

  test("spread in the handler literal is rejected", () => {
    const starter = `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const shared = { access: { openToAll: { reason: "test" } } };

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    ...shared,
  });
});
`;
    const sf = makeSourceFile(starter);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "x" },
    };
    expect(() => updatePattern(sf, change)).toThrow(/spread/);
  });

  test("a `constructor` key in set is rejected, not treated as an inherited header field", () => {
    const sf = makeSourceFile(OBJECT_FORM);
    // Bypasses the static `set` type to exercise the runtime boundary check
    // (`Object.hasOwn`, not `in`) directly.
    const change = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { constructor: "x" },
    } as unknown as HandlerHeaderUpdate;
    expect(() => updatePattern(sf, change)).toThrow(/"constructor" is not a header field/);
  });
});

describe('applyChanges — routes op: "update" to updatePattern', () => {
  test("update participates in a bulk apply", () => {
    const sf = makeSourceFile(`
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

defineFeature("inventory", (r) => {
  r.writeHandler({
    name: "item:create",
    schema: z.object({}),
    handler: async () => {},
    access: { openToAll: { reason: "test" } },
  });
});
`);
    const change: HandlerHeaderUpdate = {
      op: "update",
      id: { kind: "writeHandler", handlerName: "item:create" },
      set: { description: "Creates an item" },
    };
    applyChanges(sf, [change]);
    const reparsed = parseSourceFile(sf);
    expect(reparsed.errors).toEqual([]);
    expect(reparsed.patterns.find((p) => p.kind === "writeHandler")).toMatchObject({
      description: "Creates an item",
    });
  });
});
