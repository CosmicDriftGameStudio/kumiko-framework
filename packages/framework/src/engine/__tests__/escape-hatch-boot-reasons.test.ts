import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { validateAccessDeclarations } from "../boot-validator/access-declarations.ts";
import { createEntity, defineFeature } from "../index.ts";

const BAD_REASONS: { label: string; reason: string; message: RegExp }[] = [
  { label: "empty", reason: "", message: /non-empty/ },
  { label: "placeholder", reason: "todo", message: /placeholder/ },
];

const thingEntity = createEntity({ name: "thing", table: "things", fields: {} });

describe.each(BAD_REASONS)(
  "escapeHatch with $label reason is rejected at registration",
  ({ reason, message }) => {
    test("r.job", () => {
      expect(() =>
        defineFeature("test", (r) => {
          r.job({
            name: "sweep",
            trigger: { on: "test:event:thing-created" },
            escapeHatch: { reason, grants: ["systemIdentity"] },
            handler: async () => {},
          });
        }),
      ).toThrow(message);
    });

    test("r.hook", () => {
      expect(() =>
        defineFeature("test", (r) => {
          const thing = r.entity(thingEntity);
          r.hook({
            type: "postSave",
            target: { allOf: thing },
            handler: async () => undefined,
            escapeHatch: { reason, grants: ["systemIdentity"] },
          });
        }),
      ).toThrow(message);
    });

    test("r.applyExtension", () => {
      expect(() =>
        defineFeature("test", (r) => {
          r.applyExtension({ name: "someExtension", entity: "thing", escapeHatch: { reason } });
        }),
      ).toThrow(message);
    });
  },
);

describe("escapeHatch names its grants", () => {
  const reason = "reads every tenant for the nightly sweep";

  test("a hook escapeHatch without grants fails the boot with 'grants is required'", () => {
    expect(() =>
      defineFeature("test", (r) => {
        const thing = r.entity(thingEntity);
        r.hook({
          type: "postSave",
          target: { allOf: thing },
          handler: async () => undefined,
          // @ts-expect-error grants is required
          escapeHatch: { reason },
        });
      }),
    ).toThrow(/grants is required/);
  });

  test("a job escapeHatch without grants fails the boot with 'grants is required'", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.job({
          name: "sweep",
          trigger: { on: "test:event:thing-created" },
          // @ts-expect-error grants is required
          escapeHatch: { reason },
          handler: async () => {},
        });
      }),
    ).toThrow(/grants is required/);
  });

  test("a write handler escapeHatch without grants fails the boot with 'grants is required'", () => {
    const feature = defineFeature("test", (r) => {
      r.writeHandler({
        name: "sweep",
        schema: z.object({}),
        access: { roles: ["Admin"] },
        // @ts-expect-error grants is required
        escapeHatch: { reason },
        handler: async () => ({ isSuccess: true as const, data: {} }),
      });
    });
    expect(() => validateAccessDeclarations(feature)).toThrow(/grants is required/);
  });

  test("an extension escapeHatch carrying grants fails the boot", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.applyExtension({
          name: "someExtension",
          entity: "thing",
          escapeHatch: { reason, grants: ["unsafeRaw"] },
        });
      }),
    ).toThrow(/an extension escapeHatch always means unsafeRaw; remove grants/);
  });

  test("an extension escapeHatch with only a reason registers", () => {
    const feature = defineFeature("test", (r) => {
      r.applyExtension({ name: "someExtension", entity: "thing", escapeHatch: { reason } });
    });
    expect(feature.extensionUsages).toHaveLength(1);
  });
});
