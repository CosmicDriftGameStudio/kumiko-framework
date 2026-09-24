// Imports only via package specifiers so the KumikoExtensionOptionsMap augmentation is proven to reach
// consumers. Each @ts-expect-error has a positive control next to it, so an unrelated error cannot satisfy it.
import { expect, expectTypeOf, test } from "bun:test";
import { MAIL_TRANSPORT_EXTENSION } from "@cosmicdrift/kumiko-bundled-features/mail-foundation";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_STORAGE_PROVIDER,
  EXT_TENANT_DATA,
  EXT_USER_DATA,
  type ExtensionOptionsArgs,
  type ExtensionOptionsFor,
  type TenantDataDestroyHook,
  type TenantDataHookCtx,
  type TenantId,
  type TenantResourceDestroyHook,
  type TenantResourceHookCtx,
  type UserDataDeleteHook,
  type UserDataDeleteStrategy,
  type UserDataExportHook,
  type UserDataHookCtx,
} from "@cosmicdrift/kumiko-framework/engine";

test("useExtension accepts a well-typed tenantData destroy hook", () => {
  defineFeature("probe-tenant-data-ok", (r) => {
    r.useExtension(EXT_TENANT_DATA, "x", {
      destroy: async (ctx: TenantDataHookCtx) => {
        expectTypeOf(ctx.db).not.toBeAny();
      },
    });
  });
});

test("useExtension rejects a tenantData destroy hook with the #3196 wrong ctx shape", () => {
  defineFeature("probe-tenant-data-wrong-ctx", (r) => {
    r.useExtension(EXT_TENANT_DATA, "x", {
      // @ts-expect-error #3196: destroy ctx must be TenantDataHookCtx, not a hand-rolled { db: DbRunner; tenantId } — TenantDb is not a DbRunner.
      destroy: async (_ctx: { readonly db: DbRunner; readonly tenantId: TenantId }) => {},
    });
  });
  expectTypeOf<
    (ctx: { readonly db: DbRunner; readonly tenantId: TenantId }) => Promise<void>
  >().not.toExtend<TenantDataDestroyHook>();
});

test("useExtension requires options for a known extension name — omitting them is a type error", () => {
  defineFeature("probe-tenant-data-missing-options", (r) => {
    // @ts-expect-error tenantData's options are mandatory — a bare (name, entity) call registered no hook, silently.
    r.useExtension(EXT_TENANT_DATA, "x");
  });
  expectTypeOf<[]>().not.toExtend<ExtensionOptionsArgs<typeof EXT_TENANT_DATA>>();
});

test("useExtension infers the destroy hook's ctx type from context (positional form, no annotation)", () => {
  defineFeature("probe-tenant-data-contextual", (r) => {
    r.useExtension(EXT_TENANT_DATA, "x", {
      destroy: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<TenantDataHookCtx>();
      },
    });
  });
});

test("useExtension's object form accepts a well-typed tenantData destroy hook", () => {
  defineFeature("probe-tenant-data-object-form-ok", (r) => {
    r.useExtension({
      name: EXT_TENANT_DATA,
      entity: "x",
      destroy: async (ctx: TenantDataHookCtx) => {
        expectTypeOf(ctx.tenantId).toBeString();
      },
    });
  });
});

test("useExtension's object form rejects the #3196 wrong ctx shape", () => {
  defineFeature("probe-tenant-data-object-form-wrong-ctx", (r) => {
    r.useExtension({
      name: EXT_TENANT_DATA,
      entity: "x",
      // @ts-expect-error #3196: same mismatch as the positional form above.
      destroy: async (_ctx: { readonly db: DbRunner; readonly tenantId: TenantId }) => {},
    });
  });
  expectTypeOf<
    (ctx: { readonly db: DbRunner; readonly tenantId: TenantId }) => Promise<void>
  >().not.toExtend<TenantDataDestroyHook>();
});

test("useExtension's object form infers the destroy hook's ctx type from context (no annotation)", () => {
  defineFeature("probe-tenant-data-object-form-contextual", (r) => {
    r.useExtension({
      name: EXT_TENANT_DATA,
      entity: "x",
      destroy: async (ctx) => {
        expectTypeOf(ctx).toEqualTypeOf<TenantDataHookCtx>();
      },
    });
  });
});

test("useExtension accepts a tenantData registration with escapeHatch", () => {
  const feature = defineFeature("probe-tenant-data-escape-hatch", (r) => {
    r.useExtension(EXT_TENANT_DATA, "x", {
      destroy: async (_ctx: TenantDataHookCtx) => {},
      escapeHatch: { reason: "needs raw SQL for a batch delete" },
    });
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({
      extensionName: EXT_TENANT_DATA,
      entityName: "x",
      options: expect.objectContaining({
        escapeHatch: { reason: "needs raw SQL for a batch delete" },
      }),
    }),
  );
});

test("useExtension accepts export-only userData registration (#972)", () => {
  const exportHook: UserDataExportHook = async (_ctx) => null;
  const feature = defineFeature("probe-user-data-export-only", (r) => {
    r.useExtension(EXT_USER_DATA, "x", { export: exportHook });
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({
      extensionName: EXT_USER_DATA,
      entityName: "x",
      options: expect.objectContaining({ export: exportHook }),
    }),
  );
});

test("useExtension rejects a userData export hook with the wrong ctx shape", () => {
  defineFeature("probe-user-data-wrong-ctx", (r) => {
    r.useExtension(EXT_USER_DATA, "x", {
      // @ts-expect-error export ctx must be UserDataHookCtx (ctx.db: TenantDb), not a hand-rolled { db: DbRunner; userId }.
      export: async (_ctx: { readonly db: DbRunner; readonly userId: string }) => null,
    });
  });
  expectTypeOf<
    (ctx: { readonly db: DbRunner; readonly userId: string }) => Promise<null>
  >().not.toExtend<UserDataExportHook>();
});

test("useExtension accepts delete-only userData registration with order", () => {
  const deleteHook: UserDataDeleteHook = async (_ctx, _strategy) => undefined;
  const feature = defineFeature("probe-user-data-delete-only", (r) => {
    r.useExtension(EXT_USER_DATA, "x", { delete: deleteHook, order: 1 });
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({
      extensionName: EXT_USER_DATA,
      entityName: "x",
      options: expect.objectContaining({ delete: deleteHook, order: 1 }),
    }),
  );
});

test("useExtension infers the delete hook's ctx/strategy types from context (no annotation)", () => {
  defineFeature("probe-user-data-delete-contextual", (r) => {
    r.useExtension(EXT_USER_DATA, "x", {
      delete: async (ctx, strategy) => {
        expectTypeOf(ctx).toEqualTypeOf<UserDataHookCtx>();
        expectTypeOf(strategy).toEqualTypeOf<UserDataDeleteStrategy>();
        return undefined;
      },
    });
  });
});

test("useExtension rejects an empty userData registration", () => {
  defineFeature("probe-user-data-empty", (r) => {
    // @ts-expect-error userData needs at least one of export/delete — an empty bag silently registered neither hook.
    r.useExtension(EXT_USER_DATA, "x", {});
  });
  expectTypeOf<Record<string, never>>().not.toExtend<ExtensionOptionsFor<typeof EXT_USER_DATA>>();
});

test("useExtension rejects a userData registration with only order", () => {
  defineFeature("probe-user-data-only-order", (r) => {
    // @ts-expect-error same as the empty-bag case above: order alone registers no hook.
    r.useExtension(EXT_USER_DATA, "x", { order: 1 });
  });
  expectTypeOf<{ readonly order: number }>().not.toExtend<
    ExtensionOptionsFor<typeof EXT_USER_DATA>
  >();
});

test("useExtension accepts an unknown extension name with an arbitrary options bag", () => {
  const feature = defineFeature("probe-unknown-name", (r) => {
    r.useExtension("someAppPoint", "x", { anything: 42, goes: "here" });
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({
      extensionName: "someAppPoint",
      entityName: "x",
      options: { anything: 42, goes: "here" },
    }),
  );
});

test("useExtension accepts an unknown extension name with no options at all", () => {
  const feature = defineFeature("probe-unknown-name-no-options", (r) => {
    r.useExtension("someOtherAppPoint", "x");
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({ extensionName: "someOtherAppPoint", entityName: "x" }),
  );
});

test("useExtension accepts a string-typed extension name with an arbitrary options bag", () => {
  const name: string = "someAppPoint";
  const feature = defineFeature("probe-string-typed-name", (r) => {
    r.useExtension(name, "x", { anything: 42 });
  });
  expect(feature.extensionUsages).toContainEqual(
    expect.objectContaining({
      extensionName: "someAppPoint",
      entityName: "x",
      options: { anything: 42 },
    }),
  );
});

test("useExtension accepts a well-typed storageProvider destroyTenant hook", () => {
  defineFeature("probe-storage-provider-ok", (r) => {
    r.useExtension(EXT_STORAGE_PROVIDER, "x", {
      destroyTenant: async (tenantId: TenantId, ctx: TenantResourceHookCtx) => {
        expectTypeOf(tenantId).toBeString();
        expectTypeOf(ctx.db).not.toBeAny();
      },
    });
  });
});

test("useExtension infers the storageProvider destroyTenant hook's arg types from context", () => {
  defineFeature("probe-storage-provider-contextual", (r) => {
    r.useExtension(EXT_STORAGE_PROVIDER, "x", {
      destroyTenant: async (tenantId, ctx) => {
        expectTypeOf(tenantId).toEqualTypeOf<TenantId>();
        expectTypeOf(ctx).toEqualTypeOf<TenantResourceHookCtx>();
      },
    });
  });
});

test("useExtension rejects a storageProvider destroyTenant hook shaped like the tenantData (ctx)-only hook", () => {
  defineFeature("probe-storage-provider-wrong-shape", (r) => {
    r.useExtension(EXT_STORAGE_PROVIDER, "x", {
      // @ts-expect-error storageProvider's destroyTenant takes (tenantId, ctx) — a tenantData-style (ctx)-only hook is missing the tenantId arg.
      destroyTenant: async (_ctx: TenantDataHookCtx) => {},
    });
  });
  expectTypeOf<
    (ctx: TenantDataHookCtx) => Promise<void>
  >().not.toExtend<TenantResourceDestroyHook>();
});

test("useExtension rejects a storageProvider registration without destroyTenant", () => {
  defineFeature("probe-storage-provider-missing-hook", (r) => {
    // @ts-expect-error storageProvider requires destroyTenant — an empty bag silently registered no cleanup hook.
    r.useExtension(EXT_STORAGE_PROVIDER, "x", {});
  });
  expectTypeOf<Record<string, never>>().not.toExtend<
    ExtensionOptionsFor<typeof EXT_STORAGE_PROVIDER>
  >();
});

test("useExtension rejects a mailTransport registration without build", () => {
  defineFeature("probe-mail-transport-missing-build", (r) => {
    // @ts-expect-error mailTransport requires build — an empty bag silently registered no transport factory.
    r.useExtension(MAIL_TRANSPORT_EXTENSION, "x", {});
  });
  expectTypeOf<Record<string, never>>().not.toExtend<
    ExtensionOptionsFor<typeof MAIL_TRANSPORT_EXTENSION>
  >();
});
