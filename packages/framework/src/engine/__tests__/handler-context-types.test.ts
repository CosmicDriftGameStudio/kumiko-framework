import { expectTypeOf, test } from "bun:test";
import type {
  HandlerContext,
  JobContext,
  ProviderPluginContext,
} from "@cosmicdrift/kumiko-types/handlers";
import type { TenantDb } from "../../db/index.ts";
import { hasOutsideTransactionDb, requireOutsideTransactionDb } from "../../db/tenant-db.ts";
import { providerPluginContextFromHandler, providerPluginContextFromJob } from "../index.ts";

test("dbOutsideTransaction stays optional and hasOutsideTransactionDb narrows it", () => {
  expectTypeOf<HandlerContext["dbOutsideTransaction"]>().toEqualTypeOf<TenantDb | undefined>();
  const narrow = (ctx: HandlerContext) => {
    if (hasOutsideTransactionDb(ctx)) {
      expectTypeOf(ctx.dbOutsideTransaction).toEqualTypeOf<TenantDb>();
    }
  };
  expectTypeOf(narrow).toBeFunction();
  expectTypeOf(requireOutsideTransactionDb).returns.toEqualTypeOf<TenantDb>();
});

test("ProviderPluginContext is built from a HandlerContext and a JobContext", () => {
  expectTypeOf(providerPluginContextFromHandler).parameters.toEqualTypeOf<[ctx: HandlerContext]>();
  expectTypeOf(providerPluginContextFromHandler).returns.toEqualTypeOf<ProviderPluginContext>();
  expectTypeOf(providerPluginContextFromJob).parameters.toEqualTypeOf<[ctx: JobContext]>();
  expectTypeOf(providerPluginContextFromJob).returns.toEqualTypeOf<ProviderPluginContext>();
});
