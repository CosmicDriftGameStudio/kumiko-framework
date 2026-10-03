import type {
  Registry,
  SecretKeyDefinition,
  SecretNamespaceDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  NotFoundError,
  ValidationError,
  type WriteFailure,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";

// Fixed keys carry their definition (redact fn, writeRoles); namespace keys
// only the namespace, which has no redact fn.
export type SecretKeyWriteCheck =
  | { readonly ok: true; readonly keyDef: SecretKeyDefinition | undefined }
  | { readonly ok: false; readonly failure: WriteFailure };

function unknownKeyFailure(key: string): SecretKeyWriteCheck {
  return {
    ok: false,
    failure: writeFailure(
      new NotFoundError("secretKey", key, { i18nKey: "secrets.errors.unknownKey" }),
    ),
  };
}

function namespaceAcceptsKey(namespace: SecretNamespaceDefinition, key: string): boolean {
  const suffix = key.slice(namespace.qualifiedPrefix.length);
  if (suffix.length === 0) return false;
  return namespace.nameSchema ? namespace.nameSchema.safeParse(suffix).success : true;
}

// Only keys declared via r.secret() or under a declared r.secretNamespace()
// are writable through the API, so a tenant admin cannot plant arbitrary rows
// next to the feature-owned ones. writeRoles narrows the handler access
// further for a key or a whole namespace.
export function checkSecretKeyWrite(
  registry: Registry,
  userRoles: readonly string[],
  key: string,
): SecretKeyWriteCheck {
  const keyDef = registry.getSecretKey(key);
  const namespace = keyDef ? undefined : registry.findSecretNamespace(key);
  if (!keyDef && !(namespace && namespaceAcceptsKey(namespace, key))) {
    return unknownKeyFailure(key);
  }
  const writeRoles = keyDef?.writeRoles ?? namespace?.writeRoles;
  if (writeRoles !== undefined && !userRoles.some((role) => writeRoles.includes(role))) {
    return {
      ok: false,
      failure: writeFailure(
        new AccessDeniedError({
          message: "secret write access denied",
          i18nKey: "secrets.errors.writeDenied",
          details: { requiredRoles: writeRoles },
        }),
      ),
    };
  }
  return { ok: true, keyDef };
}

// Runs after checkSecretKeyWrite, so a caller without the write role never learns
// whether a value would have passed. The failure carries neither the value nor
// the schema's issues.
export function checkSecretValue(
  registry: Registry,
  key: string,
  value: string,
): WriteFailure | undefined {
  const valueSchema =
    registry.getSecretKey(key)?.valueSchema ?? registry.findSecretNamespace(key)?.valueSchema;
  if (valueSchema === undefined || valueSchema.safeParse(value).success) return undefined;
  return writeFailure(
    new ValidationError(
      {
        fields: [
          {
            path: "value",
            code: "invalid_secret_value",
            i18nKey: "secrets.errors.invalidValue",
          },
        ],
      },
      { i18nKey: "secrets.errors.invalidValue" },
    ),
  );
}
