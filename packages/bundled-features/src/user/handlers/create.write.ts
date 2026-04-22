import { createEventStoreExecutor } from "@kumiko/framework/db";
import { defineWriteHandler } from "@kumiko/framework/engine";
import { ConflictError, writeFailure } from "@kumiko/framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { UserErrors } from "../constants";
import { userEntity, userTable } from "../user-entity";

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
  }),
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const existing = await ctx.db
      .select({ id: userTable["id"] })
      .from(userTable)
      .where(eq(userTable["email"], event.payload.email))
      .limit(1);

    if (existing.length > 0) {
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
