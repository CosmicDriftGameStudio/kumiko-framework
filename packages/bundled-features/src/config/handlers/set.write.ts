import {
  type ConfigKeyDefinition,
  type ConfigScope,
  ConfigScopes,
  defineWriteHandler,
  type Registry,
  type SessionUser,
  SYSTEM_ROLE,
  type TenantId,
} from "@kumiko/framework/engine";
import {
  AccessDeniedError,
  type KumikoError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@kumiko/framework/errors";
import { assertUnreachable } from "@kumiko/framework/utils";
import { z } from "zod";
import { CONFIG_CHANGED_EVENT_NAME, requireConfigResolver } from "../config-feature";
import { ConfigErrors } from "../constants";

const scopeEnum = z.enum([ConfigScopes.system, ConfigScopes.tenant, ConfigScopes.user]);

export const setWrite = defineWriteHandler({
  name: "set",
  schema: z.object({
    key: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]),
    scope: scopeEnum.optional(),
  }),
  // Per-key access enforcement lives inside the handler via checkWriteAccess.
  access: { openToAll: true },
  handler: async (event, ctx) => {
    const db = ctx.db;
    const resolver = requireConfigResolver(ctx, "config:write:set");

    const prep = prepareConfigWrite({
      registry: ctx.registry,
      user: event.user,
      key: event.payload.key,
      scope: event.payload.scope,
    });
    if (!prep.ok) return prep.failure;
    const { keyDef, scope, tenantId, userId } = prep;

    const scopeError = validateScope(scope, keyDef.scope, event.payload.key);
    if (scopeError) return writeFailure(scopeError);

    const typeError = validateType(event.payload.value, keyDef);
    if (typeError) return writeFailure(typeError);

    // Bounds enforcement: hard-reject (not silent-clamp). A caller that
    // sends 9999 for a bounds.max=1000 key should see a 422 and fix their
    // input — silent clamping would make `get` return a different value
    // than what was sent, which is a UX trap with no upside.
    const boundsError = validateBounds(event.payload.value, keyDef);
    if (boundsError) return writeFailure(boundsError);

    await resolver.set(
      event.payload.key,
      keyDef,
      event.payload.value,
      tenantId,
      userId,
      event.user.id,
      db,
    );

    // Emit the change event so subscribers (SSE/cache/audit) can react.
    // Encrypted values are stripped — secrets must never land in the event
    // log. One aggregate stream per tenant (`configChanges`) — the
    // archived_streams table requires aggregateId to be a UUID, so the
    // qualified key cannot be the aggregateId. Subscribers filter by
    // payload.key + payload.scope.
    await ctx.appendEvent({
      aggregateId: event.user.tenantId,
      aggregateType: "configChanges",
      type: CONFIG_CHANGED_EVENT_NAME,
      payload: {
        key: event.payload.key,
        scope,
        action: "set",
        ...(keyDef.encrypted ? {} : { value: event.payload.value }),
      },
    });

    return {
      isSuccess: true,
      data: { key: event.payload.key, value: event.payload.value, scope },
    };
  },
});

// --- Shared helpers (used by set + reset) ---

// Three-stage pre-write gate that set + reset both need: resolve the key
// definition (404 when unknown), check the user's roles can write it (403),
// and map the target scope to the (tenantId | null, userId | null) pair the
// resolver expects. Handler-specific follow-ups (scope-compat check, value
// type check) stay inline in the handler that needs them.
export type PrepareConfigWriteArgs = {
  readonly registry: Registry;
  readonly user: SessionUser;
  readonly key: string;
  // When omitted (or explicit `undefined`), falls back to `keyDef.scope`.
  readonly scope?: ConfigScope | undefined;
};

export type PrepareConfigWriteResult =
  | { readonly ok: false; readonly failure: WriteFailure }
  | {
      readonly ok: true;
      readonly keyDef: ConfigKeyDefinition;
      readonly scope: ConfigScope;
      readonly tenantId: string | null;
      readonly userId: string | null;
    };

export function prepareConfigWrite(args: PrepareConfigWriteArgs): PrepareConfigWriteResult {
  const { registry, user, key, scope: requestedScope } = args;

  const keyDef = registry.getConfigKey(key);
  if (!keyDef) {
    return {
      ok: false,
      failure: writeFailure(
        new NotFoundError("configKey", key, { i18nKey: "config.errors.unknownKey" }),
      ),
    };
  }

  const writeError = checkWriteAccess(keyDef, user.roles);
  if (writeError) return { ok: false, failure: writeFailure(writeError) };

  const scope = requestedScope ?? keyDef.scope;
  const { tenantId, userId } = resolveScopeIds(scope, user.tenantId, user.id);
  return { ok: true, keyDef, scope, tenantId, userId };
}

export function hasConfigAccess(
  accessList: readonly string[],
  userRoles: readonly string[],
): boolean {
  if (accessList.includes("all")) return true;
  return userRoles.some((role) => accessList.includes(role));
}

export function checkWriteAccess(
  keyDef: ConfigKeyDefinition,
  userRoles: readonly string[],
): KumikoError | null {
  if (keyDef.access.write.includes(SYSTEM_ROLE)) {
    return new AccessDeniedError({
      message: "config key is system-only",
      i18nKey: "config.errors.systemOnly",
      details: { reason: ConfigErrors.systemOnly },
    });
  }
  if (!hasConfigAccess(keyDef.access.write, userRoles)) {
    return new AccessDeniedError({
      message: "config write access denied",
      details: { requiredRoles: keyDef.access.write },
    });
  }
  return null;
}

export function validateScope(
  requestedScope: ConfigScope,
  definedScope: ConfigScope,
  key: string,
): KumikoError | null {
  const levels: Record<ConfigScope, number> = {
    [ConfigScopes.system]: 0,
    [ConfigScopes.tenant]: 1,
    [ConfigScopes.user]: 2,
  };
  if (levels[requestedScope] > levels[definedScope]) {
    return new UnprocessableError("invalid_scope", {
      i18nKey: "config.errors.invalidScope",
      details: { key, definedScope, requestedScope },
    });
  }
  return null;
}

export function resolveScopeIds(
  scope: ConfigScope,
  tenantId: TenantId,
  userId: string,
): { tenantId: string | null; userId: string | null } {
  switch (scope) {
    case ConfigScopes.system:
      return { tenantId: null, userId: null };
    case ConfigScopes.tenant:
      return { tenantId, userId: null };
    case ConfigScopes.user:
      return { tenantId, userId };
    default:
      assertUnreachable(scope, "config scope");
  }
}

export function validateType(
  value: string | number | boolean,
  keyDef: ConfigKeyDefinition,
): KumikoError | null {
  switch (keyDef.type) {
    case "number":
      if (typeof value !== "number") return typeMismatch("number", typeof value);
      break;
    case "boolean":
      if (typeof value !== "boolean") return typeMismatch("boolean", typeof value);
      break;
    case "text":
      if (typeof value !== "string") return typeMismatch("string", typeof value);
      break;
    case "select":
      if (typeof value !== "string") return typeMismatch("string", typeof value);
      if (keyDef.options && !keyDef.options.includes(value)) {
        return new ValidationError({
          fields: [
            {
              path: "value",
              code: "invalid_option",
              i18nKey: "errors.validation.invalid_option",
              params: { value, options: keyDef.options },
            },
          ],
        });
      }
      break;
    default:
      assertUnreachable(keyDef.type, "config key type");
  }
  return null;
}

function typeMismatch(expected: string, actual: string): KumikoError {
  return new ValidationError({
    fields: [
      {
        path: "value",
        code: "invalid_type",
        i18nKey: "errors.validation.invalid_type",
        params: { expected, received: actual },
      },
    ],
  });
}

// Bounds enforcement for numeric config keys. Returns null when OK or when
// bounds don't apply (non-number key, no bounds declared, or upstream
// type-validation would already reject non-numeric values).
export function validateBounds(
  value: string | number | boolean,
  keyDef: ConfigKeyDefinition,
): KumikoError | null {
  if (keyDef.type !== "number" || !keyDef.bounds) return null;
  // skip: validateType runs first and catches non-numeric values
  if (typeof value !== "number") return null;

  const { min, max } = keyDef.bounds;

  if (min !== undefined && value < min) {
    return new ValidationError({
      fields: [
        {
          path: "value",
          code: "out_of_bounds",
          i18nKey: "errors.validation.out_of_bounds",
          params: { value, min, max: max ?? null },
        },
      ],
    });
  }
  if (max !== undefined && value > max) {
    return new ValidationError({
      fields: [
        {
          path: "value",
          code: "out_of_bounds",
          i18nKey: "errors.validation.out_of_bounds",
          params: { value, min: min ?? null, max },
        },
      ],
    });
  }

  return null;
}
