// Magic-Link-Signup, Step 2 (confirm).
//
// Token aus URL + Password vom User → wir lösen den Token in Redis ein
// und legen Tenant + User + Admin-Membership atomar an. emailVerified
// wird sofort auf true gesetzt — der Magic-Link IST der Beweis.
//
// Pipeline:
//   1. Redis check: token → email lookup
//   2. Single-Use-Burn (SETNX) — gleichzeitiger Klick aus zwei Tabs
//      gewinnt nur einer
//   3. Tenant-Key generieren (generateUniqueName mit DB-isAvailable-
//      check gegen tenants.key)
//   4. provisionSignupAccount: Tenant + User + Membership in einem
//      Rutsch (durch event-store-executor; events + projection +
//      MSPs sehen das wie einen regulären create)
//   5. Token-Keys löschen (burn-key bleibt für TTL-Replay-Protection)
//
// Failure-Recovery: jeder Pfad nach dem burn checked `committed`-Flag;
// bei !committed wird der burn released damit ein legitimer Retry
// nicht durch einen stale Marker geblockt wird (wie reset/verify).

import type { DbConnection } from "@kumiko/framework/db";
import { defineWriteHandler, type TenantId } from "@kumiko/framework/engine";
import { InternalError, UnprocessableError, writeFailure } from "@kumiko/framework/errors";
import { generateUniqueName } from "@kumiko/framework/random";
import { generateId } from "@kumiko/framework/utils";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantTable } from "../../tenant/schema/tenant";
import { AuthErrors } from "../constants";
// kumiko-lint-ignore cross-feature-import provisioning needs cross-feature seeding helpers
import { provisionSignupAccount } from "../seeding";
import {
  burnSignupToken,
  deleteSignupToken,
  getEmailForSignupToken,
  unburnSignupToken,
} from "../signup-token-store";

const SignupConfirmSchema = z.object({
  token: z.string().min(8),
  password: z.string().min(8).max(200),
});

export type SignupConfirmData = {
  readonly kind: "signup-completed";
  readonly userId: string;
  readonly tenantId: TenantId;
  readonly tenantKey: string;
  readonly email: string;
};

function invalidSignupToken() {
  return writeFailure(
    new UnprocessableError(AuthErrors.invalidSignupToken, {
      i18nKey: "auth.errors.invalidSignupToken",
    }),
  );
}

export function createSignupConfirmHandler() {
  return defineWriteHandler<"signup-confirm", typeof SignupConfirmSchema, SignupConfirmData>({
    name: "signup-confirm",
    schema: SignupConfirmSchema,
    access: { roles: ["all"] },
    handler: async (event, ctx) => {
      if (!ctx.redis) {
        return writeFailure(
          new InternalError({
            message: "signup-confirm requires ctx.redis for token consumption",
          }),
        );
      }

      // Token-Lookup: nicht-existent / abgelaufen / schon konsumiert →
      // alle collapsen auf invalid_signup_token. Anti-enumeration.
      const email = await getEmailForSignupToken(ctx.redis, event.payload.token);
      if (!email) return invalidSignupToken();

      // Single-Use-Burn: zwei parallele Confirms aus verschiedenen
      // Tabs — einer wins, der andere kriegt invalid_signup_token.
      const burn = await burnSignupToken(ctx.redis, event.payload.token);
      if (burn === "already-used") return invalidSignupToken();

      let committed = false;
      try {
        // Tenant-Key: 2-Wort-Slug aus framework/random, mit DB-Conflict-
        // Check gegen tenants.key. 22.500 Default-Combos + Suffix-
        // Fallback bei Kollision (siehe generateUniqueName).
        // @cast-boundary db-runner — TenantDb.raw is DbRunner (Connection|Tx);
        // provisioning helpers operate on plain drizzle-API that both shapes
        // expose identically. Inside an event-store transaction the cast lands
        // on the Tx flavor — same drizzle calls, same behavior.
        const dbConn = ctx.db.raw as DbConnection;

        const tenantKey = await generateUniqueName({
          isAvailable: async (slug) => {
            const existing = await dbConn
              .select({ id: tenantTable.id })
              .from(tenantTable)
              .where(eq(tenantTable.key, slug))
              .limit(1);
            return existing.length === 0;
          },
        });

        const tenantId = generateId() as TenantId;
        // Display-Name aus email-prefix als sinnvolles Default; User kann
        // den Tenant-Namen + sein eigenes displayName später ändern.
        const displayName = email.split("@")[0] ?? email;

        const provisioned = await provisionSignupAccount(dbConn, {
          email,
          password: event.payload.password,
          displayName,
          tenantId,
          tenantKey,
          // Tenant-Display-Name als Default = Email. User wechselt das im
          // Settings-Screen. Konzept "Tenant" leakt nicht in die Signup-UI.
          tenantName: email,
        });

        // Cleanup beider Token-Lookup-Keys. Burn-Key bleibt für die
        // restliche Burn-TTL als Replay-Schutz.
        await deleteSignupToken(ctx.redis, { email, token: event.payload.token });

        committed = true;
        return {
          isSuccess: true,
          data: {
            kind: "signup-completed",
            userId: provisioned.userId,
            tenantId: provisioned.tenantId,
            tenantKey,
            email,
          },
        };
      } finally {
        if (!committed && ctx.redis) {
          // Burn-release damit ein retry nach DB-Hiccup nicht blockt.
          // Token-Lookup-Keys bleiben — der User kann seinen Mail-Link
          // erneut klicken.
          await unburnSignupToken(ctx.redis, event.payload.token);
        }
      }
    },
  });
}
