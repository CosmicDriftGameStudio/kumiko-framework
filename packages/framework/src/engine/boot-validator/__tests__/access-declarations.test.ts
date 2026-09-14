import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import { buildUpdateSchema } from "../../schema-builder";
import type { AccessRule, EntityDefinition, WriteHandlerDef } from "../../types";
import { validateAccessDeclarations } from "../access-declarations";

const noteEntity = createEntity({
  table: "fw2855_guard_notes",
  fields: {
    email: createTextField({ personal: "self", find: "none" }),
    title: createTextField({ personal: false, reason: "test_fixture" }),
  },
});

describe("validateAccessDeclarations", () => {
  // 1. openToAll reason must be non-empty.
  test("openToAll with an empty reason throws, naming the handler", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { openToAll: { reason: "" } },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:create"/);
  });

  test("openToAll with a non-empty reason boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { openToAll: { reason: "internal signup form" } },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });

  // 1b. malformed openToAll (from untyped sources) counts as invalid, not a crash.
  test.each([{ openToAll: false }, { openToAll: {} }])(
    "malformed openToAll %p throws, naming the handler",
    (access) => {
      const feature = defineFeature("notes", (r) => {
        r.entity("note", noteEntity);
        r.writeHandler(
          "note:create",
          z.object({ title: z.string() }),
          async () => ({
            isSuccess: true as const,
            data: {},
          }),
          {
            // @cast-boundary test — simulates JSON/Designer input that doesn't match the static union
            access: access as unknown as AccessRule,
          },
        );
      });
      expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
      expect(() => validateAccessDeclarations(feature)).toThrow(/"note:create"/);
    },
  );

  // 2. escapeHatch reason must be non-empty.
  test("escapeHatch with an empty reason throws, naming the handler", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["Admin"] },
          escapeHatch: { reason: "" },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:create"/);
  });

  test("escapeHatch with a non-empty reason boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ title: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { roles: ["Admin"] },
          escapeHatch: { reason: "cross-tenant note import job" },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });

  // 2b. escapeHatch reason must be non-empty on a query handler too (fw#2859:
  // query handlers can't reach db.global(), but they can still declare
  // escapeHatch to switch identity to SYSTEM via ctx.queryAs).
  test("query handler escapeHatch with an empty reason throws, naming the handler", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.queryHandler("note:list", z.object({}), async () => [], {
        access: { roles: ["Admin"] },
        escapeHatch: { reason: "" },
      });
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:list"/);
  });

  test("query handler escapeHatch with a non-empty reason boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.queryHandler("note:list", z.object({}), async () => [], {
        access: { roles: ["Admin"] },
        escapeHatch: { reason: "cross-tenant note lookup for auth" },
      });
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });

  // 3. openToAll write handler accepting a personal-data field needs publicIntake.
  test("openToAll write handler accepting a personal-data field without publicIntake throws", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ email: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { openToAll: { reason: "public signup" } },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:create"/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"email"/);
  });

  test("openToAll write handler accepting a personal-data field WITH publicIntake boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.writeHandler(
        "note:create",
        z.object({ email: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: {},
        }),
        {
          access: { openToAll: { reason: "public signup" }, publicIntake: true },
        },
      );
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });

  // 4. publicIntake is only meaningful on a write handler.
  test("publicIntake on a query handler throws", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.queryHandler("note:list", z.object({}), async () => [], {
        access: { openToAll: { reason: "public listing" }, publicIntake: true },
      });
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:list"/);
  });

  test("query handler without publicIntake boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.queryHandler("note:list", z.object({}), async () => [], {
        access: { openToAll: { reason: "public listing" } },
      });
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });

  test("publicIntake on a stream handler throws", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.streamHandler("note:watch", z.object({}), async function* () {}, {
        access: { openToAll: { reason: "public stream" }, publicIntake: true },
      });
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/Feature notes/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:watch"/);
  });

  test("stream handler without publicIntake boots fine", () => {
    const feature = defineFeature("notes", (r) => {
      r.entity("note", noteEntity);
      r.streamHandler("note:watch", z.object({}), async function* () {}, {
        access: { openToAll: { reason: "public stream" } },
      });
    });
    expect(() => validateAccessDeclarations(feature)).not.toThrow();
  });
});

const openToAll = { openToAll: { reason: "any member may edit" } } as const;

function featureWithWriteHandler(
  schema: z.ZodType,
  options: Pick<WriteHandlerDef, "access" | "escapeHatch"> = { access: openToAll },
  handlerName = "note:update",
  entity: EntityDefinition = noteEntity,
) {
  return defineFeature("notes", (r) => {
    r.entity("note", entity);
    r.writeHandler(
      handlerName,
      schema,
      async () => ({ isSuccess: true as const, data: {} }),
      options,
    );
  });
}

describe("validateAccessDeclarations — personal-data fields beyond a top-level object", () => {
  test.each([
    ["intersection", z.intersection(z.object({ email: z.string() }), z.object({ id: z.string() }))],
    ["union", z.union([z.object({ email: z.string() }), z.object({ title: z.string() })])],
    [
      "discriminated union",
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), email: z.string() }),
        z.object({ kind: z.literal("b"), title: z.string() }),
      ]),
    ],
    ["transform", z.object({ email: z.string() }).transform((v) => v)],
    ["preprocess", z.preprocess((v) => v, z.object({ email: z.string() }))],
    ["pipe", z.unknown().pipe(z.object({ email: z.string() }))],
    ["readonly", z.object({ email: z.string() }).readonly()],
    ["catch", z.object({ email: z.string() }).catch({ email: "" })],
    [
      "wrapper around intersection",
      z.intersection(z.object({ email: z.string() }), z.object({})).optional(),
    ],
    [
      "nested update changes",
      z.object({
        id: z.string(),
        version: z.number(),
        changes: z.object({ email: z.string() }).partial(),
      }),
    ],
    ["array of objects", z.object({ entries: z.array(z.object({ email: z.string() })) })],
    [
      "record of objects",
      z.object({ byId: z.record(z.string(), z.object({ email: z.string() })) }),
    ],
    [
      "lazy",
      z.object({ inner: z.lazy(() => z.object({ email: z.string().nullable().default(null) })) }),
    ],
  ])("openToAll write handler with a personal-data field inside a %s throws", (_label, schema) => {
    const feature = featureWithWriteHandler(schema);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"note:update"/);
    expect(() => validateAccessDeclarations(feature)).toThrow(/"email"/);
  });

  test("recursive lazy schema terminates and still finds the field", () => {
    type Tree = { email?: string; children: Tree[] };
    const tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({ email: z.string().optional(), children: z.array(tree) }),
    );
    expect(() => validateAccessDeclarations(featureWithWriteHandler(tree))).toThrow(/"email"/);
  });

  test("a lazy getter that builds a new schema on every call fails loudly instead of looping", () => {
    const endless = (): z.ZodType => z.object({ title: z.string(), next: z.lazy(endless) });
    expect(() => validateAccessDeclarations(featureWithWriteHandler(endless()))).toThrow(
      /more than 10000 nodes/,
    );
  });

  // Mirrors kumiko-credit's `update` (intersection of a refined object with { id })
  // and `bauspar:update` ({ id, version, changes }) on a tenant-trust entity.
  test("credit-style update schemas without owner binding throw", () => {
    const credit = createEntity({
      table: "fw_access_pii_credit",
      fields: {
        name: createTextField({ personal: { of: "ownerUserId" }, find: "none" }),
        ownerUserId: createTextField({ required: false, personal: "ref" }),
      },
    });
    const refined = z.object({ name: z.string() }).refine((c) => c.name.length > 0);
    const intersectionUpdate = z.intersection(refined, z.object({ id: z.string() }));
    const changesUpdate = z.object({
      id: z.uuid(),
      version: z.number(),
      changes: buildUpdateSchema(credit).omit({ ownerUserId: true }),
    });
    for (const schema of [intersectionUpdate, changesUpdate]) {
      const feature = featureWithWriteHandler(schema, { access: openToAll }, "note:update", credit);
      expect(() => validateAccessDeclarations(feature)).toThrow(/"name"/);
    }
  });
});
