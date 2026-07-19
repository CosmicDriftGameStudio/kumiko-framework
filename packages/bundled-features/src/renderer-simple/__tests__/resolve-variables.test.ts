import { describe, expect, test } from "bun:test";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import type { RendererContext } from "../../renderer-foundation";
import { resolveNotificationVariables } from "../resolve-variables";

describe("resolveNotificationVariables :: template-resolver not mounted", () => {
  test("template slug set but template-resolver isn't mounted → falls back to variables, never touches ctx.db", async () => {
    // Truthy-but-poisoned db: if the guard ever regresses to only checking
    // `!ctx.db`, calling anything on this throws instead of silently
    // succeeding — the test fails loud, not by accident.
    const poisonedDb = new Proxy(
      {},
      {
        get(): never {
          throw new Error(
            "resolveNotificationVariables must not touch ctx.db when template-resolver isn't mounted",
          );
        },
      },
    );
    const ctx: RendererContext = {
      db: poisonedDb as never,
      registry: { features: new Map() } as never,
      tenantId: "11111111-1111-4111-8111-111111111111" as TenantId,
    };

    const result = await resolveNotificationVariables(
      {
        kind: "notification",
        payload: { template: "welcome-email", variables: { name: "Ada" } },
      },
      ctx,
    );

    expect(result).toEqual({ name: "Ada" });
  });
});
