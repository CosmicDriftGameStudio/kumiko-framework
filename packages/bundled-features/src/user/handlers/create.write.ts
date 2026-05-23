import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import { defineWriteHandler } from "@cosmicdrift/kumiko-framework/engine";
import { ConflictError, writeFailure } from "@cosmicdrift/kumiko-framework/errors";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { z } from "zod";
import { UserErrors } from "../constants";
import { userEntity, userTable } from "../schema/user";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// Only the Auth features (running as SYSTEM) or a SystemAdmin may create users.
//
// Email uniqueness is checked via a pre-flight query — the framework has no
// `unique:` field flag yet. This check is race-prone: two concurrent requests
// can both see "no duplicate" and both insert. Acceptable MVP behavior since
// user creation is low-frequency and gated by privileged roles; the DB will
// still surface a pg unique violation once we add the constraint.
// TODO: replace with a real `unique:` field flag + DB constraint.
export const createWrite = defineWriteHandler({
  name: "user:create",
  schema: z.object({
    email: z.email(),
    passwordHash: z.string().optional(),
    displayName: z.string().min(1).max(100),
    locale: z.string().min(2).max(10).optional(),
    // Globale Rollen — JSON-encoded string[]. Optional weil der Default
    // im Entity-Schema "[]" ist; setzen wenn man einen SystemAdmin (oder
    // andere globale Rollen) anlegt. Field-Access (write: privileged) auf
    // der Entity ist die letzte Hand: wer auch immer create dispatcht ist
    // schon privileged (system/SystemAdmin), aber das Field-Guard läuft
    // trotzdem als defense-in-depth.
    roles: z.string().optional(),
  }),
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const existing = await fetchOne<{ id: string }>(ctx.db, userTable, { email: event.payload.email });

    if (existing) {
      return writeFailure(
        new ConflictError({
          message: "email already exists",
          i18nKey: "user.errors.emailAlreadyExists",
          details: { reason: UserErrors.emailAlreadyExists, field: "email" },
        }),
      );
    }

    return crud.create(event.payload, event.user, ctx.db);
  },
});
