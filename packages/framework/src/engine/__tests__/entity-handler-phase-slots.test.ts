import { describe, expect, test } from "bun:test";
import { defineFeature } from "../define-feature.ts";
import { defineWriteHandler } from "../define-handler.ts";
import { defineEntityCreateHandler, defineEntityDeleteHandler } from "../entity-handlers.ts";
import { createEntity, createTextField } from "../factories.ts";

const taskEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture" }) },
});
const access = { roles: ["Admin"] };

describe("entity write handlers leave the transaction phase slots unset", () => {
  test("a consumer can destructure one, add its own typed phases and spread the rest", () => {
    const baseCreate = defineEntityCreateHandler("task", taskEntity, { access });
    const typedPhases = defineWriteHandler({
      name: baseCreate.name,
      schema: baseCreate.schema,
      access: baseCreate.access,
      beforeTransaction: async () => ({ isSuccess: true as const, data: { prepared: 1 } }),
      handler: async (event) => ({
        isSuccess: true as const,
        data: { prepared: event.prepared.prepared },
      }),
    });
    const {
      handler: _handler,
      beforeTransaction: _beforeTransaction,
      ...entityConventions
    } = baseCreate;
    const merged = { ...entityConventions, ...typedPhases };

    defineFeature("tasks", (r) => {
      r.entity({ name: "task", ...taskEntity });
      r.writeHandler(merged);
    });

    expect(merged.beforeTransaction).toBe(typedPhases.beforeTransaction);
    expect(merged.handler).toBe(typedPhases.handler);
    expect(merged.name).toBe("task:create");
  });

  test("create and delete handlers carry no phase slot at runtime", () => {
    for (const handler of [
      defineEntityCreateHandler("task", taskEntity, { access }),
      defineEntityDeleteHandler("task", taskEntity, { access }),
    ]) {
      expect(handler.reserveBeforeTransaction).toBeUndefined();
      expect(handler.beforeTransaction).toBeUndefined();
      expect(handler.beforeTransactionWhenNested).toBeUndefined();
    }
  });
});
