import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import { AccessDeniedError } from "../../errors";
import { createGatedIdentitySwitch, type QueryAsFn } from "../../pipeline/system-identity-switch";
import {
  createEntity,
  createRegistry,
  createSystemUser,
  createTextField,
  defineFeature,
} from "../index";
import type { AppContext, SaveContext } from "../types";
import type { TenantId } from "../types/identifiers";

const TENANT = "00000000-0000-4000-8000-00000000ee01" as TenantId;
const dummySaveContext: SaveContext = {
  kind: "save",
  id: "vehicle-1" as SaveContext["id"],
  data: {},
  changes: {},
  previous: {},
  isNew: true,
};

describe("extendsRegistrar", () => {
  test("r.useExtension records usage with name, entity, and options", () => {
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      r.useExtension("customFields", "vehicle", { allowTypes: ["text", "number"] });
    });

    expect(consumer.extensionUsages).toHaveLength(2);
    expect(consumer.extensionUsages[0]).toEqual({
      extensionName: "tags",
      entityName: "vehicle",
      options: undefined,
    });
    expect(consumer.extensionUsages[1]).toEqual({
      extensionName: "customFields",
      entityName: "vehicle",
      options: { allowTypes: ["text", "number"] },
    });
  });

  test("registry calls onRegister for each extension usage", () => {
    const onRegister = mock();

    const ext = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister });
    });

    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
    });

    createRegistry([ext, consumer]);

    expect(onRegister).toHaveBeenCalledTimes(1);
    expect(onRegister).toHaveBeenCalledWith("vehicle", undefined);
  });

  test("registry throws on duplicate extension name", () => {
    const f1 = defineFeature("a", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const f2 = defineFeature("b", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });

    expect(() => createRegistry([f1, f2])).toThrow(/duplicate registrar extension.*tags/i);
  });

  test("getExtensionUsages returns filtered usages", () => {
    const ext1 = defineFeature("tags", (r) => {
      r.extendsRegistrar("tags", { onRegister: () => {} });
    });
    const ext2 = defineFeature("comments", (r) => {
      r.extendsRegistrar("commentable", { onRegister: () => {} });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("tags", "vehicle");
      r.useExtension("commentable", "vehicle");
      r.useExtension("tags", "driver");
    });

    const registry = createRegistry([ext1, ext2, consumer]);
    expect(registry.getExtensionUsages("tags")).toHaveLength(2);
    expect(registry.getExtensionUsages("commentable")).toHaveLength(1);
    expect(registry.getExtensionUsages("nonexistent")).toHaveLength(0);
  });

  test("extendSchema merges extra fields into entity definition", () => {
    const ext = defineFeature("customFields", (r) => {
      r.extendsRegistrar("customFields", {
        extendSchema: () => ({
          customData: { type: "text" as const },
        }),
      });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity(
        "vehicle",
        createEntity({
          table: "Vehicles",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.useExtension("customFields", "vehicle");
    });

    const registry = createRegistry([ext, consumer]);
    const entity = registry.getEntity("vehicle");
    expect(entity?.fields["name"]).toBeDefined();
    expect(entity?.fields["customData"]).toBeDefined();
    expect(entity?.fields["customData"]?.type).toBe("text");
  });

  test("extension preSave hooks fire for bare CRUD handler with smart entity map", () => {
    const preSaveFn = mock(async (changes: Record<string, unknown>) => changes);

    const ext = defineFeature("audit", (r) => {
      r.extendsRegistrar("audited", {
        hooks: { preSave: preSaveFn },
      });
    });
    const consumer = defineFeature("credit", (r) => {
      r.requires("audit");
      r.entity(
        "credit",
        createEntity({
          table: "Credits",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      r.writeHandler(
        "create",
        z.object({ name: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: { id: "c1" },
        }),
        { access: { openToAll: true } },
      );
      r.useExtension("audited", "credit");
    });

    const registry = createRegistry([ext, consumer]);
    const hooks = registry.getPreSaveHooks("credit:write:create");
    expect(hooks.length).toBeGreaterThan(0);
  });

  test("extension preSave hooks fire for entity-scoped handlers", async () => {
    const preSaveFn = mock(async (changes: Record<string, unknown>) => changes);

    const ext = defineFeature("audit", (r) => {
      r.extendsRegistrar("audited", {
        hooks: {
          preSave: preSaveFn,
        },
      });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity(
        "vehicle",
        createEntity({
          table: "Vehicles",
          idType: "uuid",
          fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
        }),
      );
      // Explicit handlers — the entity mapping is inferred from the
      // "vehicle:" prefix via tryMapEntity, so the extension's preSave
      // wires onto every entity-scoped handler automatically.
      r.writeHandler(
        "vehicle:create",
        z.object({ name: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: { id: "v1" },
        }),
        { access: { openToAll: true } },
      );
      r.writeHandler(
        "vehicle:update",
        z.object({ id: z.string() }),
        async () => ({
          isSuccess: true as const,
          data: { id: "v1" },
        }),
        { access: { openToAll: true } },
      );
      r.useExtension("audited", "vehicle");
    });

    const registry = createRegistry([ext, consumer]);
    const createHooks = registry.getPreSaveHooks("fleet:write:vehicle:create");
    expect(createHooks).toHaveLength(1);
    // Hook is wrapped for the SYSTEM gate (system-identity-switch.ts), so it's no longer reference-equal to preSaveFn.
    const preSaveContext = { previous: {}, isNew: true } as AppContext & {
      previous: Readonly<Record<string, unknown>>;
      isNew: boolean;
    };
    await createHooks[0]?.({ name: "x" }, preSaveContext);
    expect(preSaveFn).toHaveBeenCalledTimes(1);

    const updateHooks = registry.getPreSaveHooks("fleet:write:vehicle:update");
    expect(updateHooks).toHaveLength(1);
  });

  test("extension postSave hooks are entity hooks", async () => {
    const postSaveFn = mock(async () => {});

    const ext = defineFeature("audit", (r) => {
      r.extendsRegistrar("audited", {
        hooks: {
          postSave: postSaveFn,
        },
      });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("audited", "vehicle");
    });

    const registry = createRegistry([ext, consumer]);
    const hooks = registry.getEntityPostSaveHooks("vehicle");
    expect(hooks).toHaveLength(1);
    await hooks[0]?.(dummySaveContext, {} as AppContext);
    expect(postSaveFn).toHaveBeenCalledTimes(1);
  });

  test("extension postSave hook cannot switch identity to SYSTEM — no declaration site to opt in with", async () => {
    const ungatedQueryAs = mock(async () => "ok");
    const ungated = {
      queryAs: ungatedQueryAs as QueryAsFn,
      writeAs: async () => ({ isSuccess: true as const, data: null }),
    };
    // Simulates a handler whose OWN grant is allow=true (escapeHatch or
    // systemScope) — the extension hook must not inherit this.
    const handlerCtx = createGatedIdentitySwitch(
      'handler "fleet:write:vehicle:create"',
      undefined,
      true,
      ungated,
    );

    let caught: unknown;
    const ext = defineFeature("audit", (r) => {
      r.extendsRegistrar("audited", {
        hooks: {
          postSave: async (_result, ctx) => {
            const asContext = ctx as unknown as { queryAs: QueryAsFn };
            try {
              await asContext.queryAs(createSystemUser(TENANT), "whoami", {});
            } catch (err) {
              caught = err;
            }
          },
        },
      });
    });
    const consumer = defineFeature("fleet", (r) => {
      r.entity("vehicle", createEntity({ table: "Vehicles", fields: {} }));
      r.useExtension("audited", "vehicle");
    });

    const registry = createRegistry([ext, consumer]);
    const hooks = registry.getEntityPostSaveHooks("vehicle");
    expect(hooks).toHaveLength(1);

    await hooks[0]?.(dummySaveContext, handlerCtx as unknown as AppContext);

    expect(caught).toBeInstanceOf(AccessDeniedError);
    expect(ungatedQueryAs).not.toHaveBeenCalled();
  });
});
