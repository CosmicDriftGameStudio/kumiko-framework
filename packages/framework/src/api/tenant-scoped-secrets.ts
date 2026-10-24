import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../db/row-level-security-scope.ts";
import type { TenantId } from "../engine/types/index.ts";
import type { SecretsContext } from "../secrets/index.ts";

// Signature routes run before any tenant scope exists, and plugin code parses unauthenticated bytes,
// so only the secret accesses themselves open a scope, and only for the tenant the call names.
export function tenantScopedSecrets(secrets: SecretsContext): SecretsContext {
  const scoped = <T>(tenantId: TenantId, run: () => Promise<T>): Promise<T> =>
    runInRowLevelSecurityScope(tenantRowLevelSecurityScope(tenantId), run);
  return {
    withRunner: (runner) => tenantScopedSecrets(secrets.withRunner(runner)),
    get: (tenantId, ...rest) => scoped(tenantId, () => secrets.get(tenantId, ...rest)),
    has: (tenantId, ...rest) => scoped(tenantId, () => secrets.has(tenantId, ...rest)),
    set: (tenantId, ...rest) => scoped(tenantId, () => secrets.set(tenantId, ...rest)),
    delete: (tenantId, ...rest) => scoped(tenantId, () => secrets.delete(tenantId, ...rest)),
  };
}
