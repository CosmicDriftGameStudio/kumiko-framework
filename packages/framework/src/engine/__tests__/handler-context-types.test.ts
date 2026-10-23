import { expectTypeOf, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "../../db/index.ts";
import { hasOutsideTransactionDb, requireOutsideTransactionDb } from "../../db/tenant-db.ts";

test("dbOutsideTransaction stays optional and hasOutsideTransactionDb narrows it", () => {
  expectTypeOf<HandlerContext["db"]["outsideTransaction"]>().toEqualTypeOf<TenantDb | undefined>();
  const narrow = (ctx: HandlerContext) => {
    if (hasOutsideTransactionDb(ctx)) {
      expectTypeOf(ctx.db.outsideTransaction).toEqualTypeOf<TenantDb>();
    }
  };
  expectTypeOf(narrow).toBeFunction();
  expectTypeOf(requireOutsideTransactionDb).returns.toEqualTypeOf<TenantDb>();
});
