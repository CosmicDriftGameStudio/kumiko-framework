// Imports only via package specifiers so the KumikoExtensionOptionsMap augmentation is proven to reach
// consumers. Each @ts-expect-error has a positive control next to it, so an unrelated error cannot satisfy it.
import { expectTypeOf, test } from "bun:test";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  EXT_TENANT_DATA,
  EXT_USER_DATA,
  type TenantDataHookCtx,
  type TenantId,
  type UserDataDeleteStrategy,
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
  defineFeature("probe-tenant-data-escape-hatch", (r) => {
    r.useExtension(EXT_TENANT_DATA, "x", {
      destroy: async (_ctx: TenantDataHookCtx) => {},
      escapeHatch: { reason: "needs raw SQL for a batch delete" },
    });
  });
});

test("useExtension accepts export-only userData registration (#972)", () => {
  defineFeature("probe-user-data-export-only", (r) => {
    r.useExtension(EXT_USER_DATA, "x", {
      export: async (_ctx: UserDataHookCtx) => null,
    });
  });
});

test("useExtension rejects a userData export hook with the wrong ctx shape", () => {
  defineFeature("probe-user-data-wrong-ctx", (r) => {
    r.useExtension(EXT_USER_DATA, "x", {
      // @ts-expect-error export ctx must be UserDataHookCtx (ctx.db: TenantDb), not a hand-rolled { db: DbRunner; userId }.
      export: async (_ctx: { readonly db: DbRunner; readonly userId: string }) => null,
    });
  });
});

test("useExtension accepts delete-only userData registration with order", () => {
  defineFeature("probe-user-data-delete-only", (r) => {
    r.useExtension(EXT_USER_DATA, "x", {
      delete: async (_ctx: UserDataHookCtx, _strategy) => undefined,
      order: 1,
    });
  });
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
});

test("useExtension rejects a userData registration with only order", () => {
  defineFeature("probe-user-data-only-order", (r) => {
    // @ts-expect-error same as the empty-bag case above: order alone registers no hook.
    r.useExtension(EXT_USER_DATA, "x", { order: 1 });
  });
});

test("useExtension accepts an unknown extension name with an arbitrary options bag", () => {
  defineFeature("probe-unknown-name", (r) => {
    r.useExtension("someAppPoint", "x", { anything: 42, goes: "here" });
  });
});

test("useExtension accepts a string-typed extension name with an arbitrary options bag", () => {
  defineFeature("probe-string-typed-name", (r) => {
    const name: string = "someAppPoint";
    r.useExtension(name, "x", { anything: 42 });
  });
});
