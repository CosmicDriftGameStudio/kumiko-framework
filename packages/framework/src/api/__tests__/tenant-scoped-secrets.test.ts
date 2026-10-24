import { describe, expect, test } from "bun:test";
import {
  activeRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "../../db/row-level-security-scope.ts";
import type { TenantId } from "../../engine/types/index.ts";
import type { SecretsContext } from "../../secrets/index.ts";
import { tenantScopedSecrets } from "../tenant-scoped-secrets.ts";

const TENANT_A = "00000000-0000-4000-8000-00000000000a" as TenantId;
const TENANT_B = "00000000-0000-4000-8000-00000000000b" as TenantId;

function observingSecrets(seen: unknown[]): SecretsContext {
  const observe = async <T>(value: T): Promise<T> => {
    seen.push(activeRowLevelSecurityScope());
    return value;
  };
  const self: SecretsContext = {
    withRunner: () => self,
    get: () => observe(undefined),
    has: () => observe(true),
    set: () => observe(undefined),
    delete: () => observe(true),
  };
  return self;
}

describe("tenantScopedSecrets", () => {
  test("each call runs in the scope of the tenant it names", async () => {
    const seen: unknown[] = [];
    const secrets = tenantScopedSecrets(observingSecrets(seen));
    await secrets.get(TENANT_A, "k");
    await secrets.has(TENANT_B, "k");
    await secrets.set(TENANT_A, "k", "v");
    await secrets.delete(TENANT_B, "k");
    expect(seen).toEqual([
      tenantRowLevelSecurityScope(TENANT_A),
      tenantRowLevelSecurityScope(TENANT_B),
      tenantRowLevelSecurityScope(TENANT_A),
      tenantRowLevelSecurityScope(TENANT_B),
    ]);
  });

  test("withRunner keeps the per-call scope", async () => {
    const seen: unknown[] = [];
    const secrets = tenantScopedSecrets(observingSecrets(seen)).withRunner({} as never);
    await secrets.has(TENANT_A, "k");
    expect(seen).toEqual([tenantRowLevelSecurityScope(TENANT_A)]);
  });

  test("no scope leaks outside the call", async () => {
    await tenantScopedSecrets(observingSecrets([])).has(TENANT_A, "k");
    expect(activeRowLevelSecurityScope()).toBeUndefined();
  });
});
