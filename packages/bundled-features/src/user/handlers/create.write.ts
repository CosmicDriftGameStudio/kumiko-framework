import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEventStoreExecutor } from "@cosmicdrift/kumiko-framework/db";
import {
  defineWriteHandler,
  findForbiddenRoleAssignment,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  ConflictError,
  InternalError,
  type WriteErrorInfo,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { isValidLocaleTag } from "@cosmicdrift/kumiko-framework/i18n";
import { isValidIanaTimeZone } from "@cosmicdrift/kumiko-framework/time";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { z } from "zod";
import { UserErrors } from "../constants";
import { userEntity, userTable } from "../schema/user";

const crud = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

// Only the Auth features (running as SYSTEM) or a SystemAdmin may create users.
//
// Email uniqueness has two layers (fw#2134):
// 1. A pre-flight fetchOne — fast-fails with a friendly error on the
// common case, but is race-prone on its own: two concurrent requests
// can both see "no duplicate" and both proceed to crud.create.
// 2. The real guard is the unique index over email's blind-index column
// (schema/user.ts). A losing concurrent create hits that constraint
// and crud.create returns a UniqueViolationError (framework's F8
// pg-23505 mapping) instead of throwing — remapped below to the same
// emailAlreadyExists shape the pre-flight path returns, so callers see
// one consistent error regardless of which layer caught the race.
export const createWrite = defineWriteHandler({
  name: "user:create",
  schema: z.object({
    email: z.email(),
    passwordHash: z.string().optional(),
    displayName: z.string().min(1).max(100),
    locale: z.string().min(2).max(10).refine(isValidLocaleTag, "invalid locale tag").optional(),
    timezone: z.string().max(64).refine(isValidIanaTimeZone, "invalid IANA time zone").optional(),
    // Global roles — string[] only (entity default []). A bare string used to
    // parse to [] via parseRoles and silently create a role-less user.
    // Field-level write access (privileged) is defense-in-depth — create is
    // already system/SystemAdmin-only.
    roles: z.array(z.string()).optional(),
  }),
  access: { roles: ["system", "SystemAdmin"] },
  handler: async (event, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({ message: "user:create requires r.systemScope()" });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant(
      "user rows are tenant-agnostic identity records; uniqueness check and create need no tenant filter",
    );

    const existing = await fetchOne<{ id: string }>(db, userTable, {
      email: event.payload.email,
    });

    if (existing) {
      return writeFailure(
        new ConflictError({
          message: "email already exists",
          i18nKey: "user.errors.emailAlreadyExists",
          details: { reason: UserErrors.emailAlreadyExists, field: "email" },
        }),
      );
    }

    let createPayload = event.payload;
    if (event.payload.roles !== undefined) {
      const newRoles = parseRoles(event.payload.roles);
      const forbidden = findForbiddenRoleAssignment(event.user.roles, newRoles, []);
      if (forbidden !== undefined) {
        return writeFailure(
          new AccessDeniedError({
            message: `role "${forbidden}" cannot be assigned by this actor`,
            i18nKey: "user.errors.roleElevationForbidden",
            details: { reason: UserErrors.roleElevationForbidden, role: forbidden },
          }),
        );
      }
      createPayload = { ...event.payload, roles: newRoles };
    }

    const result = await crud.create(createPayload, event.user, db);
    if (!result.isSuccess && isEmailUniqueViolation(result.error)) {
      return writeFailure(
        new ConflictError({
          message: "email already exists",
          i18nKey: "user.errors.emailAlreadyExists",
          details: {
            reason: UserErrors.emailAlreadyExists,
            field: "email",
            constraintName: constraintNameOf(result.error),
          },
        }),
      );
    }
    return result;
  },
});

// schema/user.ts's `read_users_email_unique` (+ its generated `_bidx`
// pendant) is the actual race-safety net behind the pre-flight check
// above — a losing concurrent create surfaces here as a generic
// UniqueViolationError (framework F8 pg-23505 mapping). Only the email
// constraint gets remapped; any other unique_violation on this entity
// passes through unchanged.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function constraintNameOf(error: WriteErrorInfo): string | undefined {
  if (!isRecord(error.details)) return undefined;
  const constraintName = error.details["constraintName"];
  return typeof constraintName === "string" ? constraintName : undefined;
}

function isEmailUniqueViolation(error: WriteErrorInfo): boolean {
  return (
    error.code === "unique_violation" &&
    (constraintNameOf(error)?.startsWith("read_users_email_unique") ?? false)
  );
}
