import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineFeature } from "../../define-feature";
import { createEntity, createTextField } from "../../factories";
import type { AccessRule } from "../../types";
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
