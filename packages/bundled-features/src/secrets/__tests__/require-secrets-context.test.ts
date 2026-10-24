// Verifies that `requireSecretsContext` works with the narrow FileProviderContext
// surface, not only with the full HandlerContext.
// Regression guard for the latent worker-path bug:
//   - Before the fix, `ctx as unknown as HandlerContext` was passed through
//   - In the worker path, `ctx.auditUserId` is undefined (handler contexts leave it unset;
//     requireSecretsContext falls back to ctx.user.id), causing `auditUserId missing` to be thrown
//   - The worker wrapper now explicitly sets `auditUserId: SYSTEM_USER_ID`
//
// The test exercises both surfaces (HandlerContext shape via a type assertion
// and FileProviderContext shape directly) and verifies that both the happy path
// and the missing-auditUserId error are handled.

import { describe, expect, mock, test } from "bun:test";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { requireSecretsContext } from "../feature.ts";

function makeRawSecretsContext(): SecretsContext {
  return {
    get: mock(),
    has: mock(),
    set: mock(),
    delete: mock(),
    withRunner: mock(),
  };
}

describe("requireSecretsContext :: FileProviderContext surface", () => {
  test("succeeds with secrets + auditUserId present (Worker-Pfad mit SYSTEM_USER_ID)", () => {
    const fileProviderCtx = {
      secrets: makeRawSecretsContext(),
      auditUserId: SYSTEM_USER_ID,
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).not.toThrow();
  });

  test("throws when auditUserId is missing (latenter Worker-Bug pre-3b.fix)", () => {
    // Pins the trap the 3b fix catches: when a provider plugin calls
    // `requireSecretsContext` and the ctx has no auditUserId (for example
    // because an r.job wrap forgot to set it), it fails early with a clear
    // error instead of breaking silently.
    const fileProviderCtx = {
      secrets: makeRawSecretsContext(),
      auditUserId: undefined,
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).toThrow(
      /auditUserId missing/,
    );
  });

  test("handler contexts audit as ctx.user.id when no auditUserId is set", async () => {
    const audits: unknown[] = [];
    const raw: SecretsContext = {
      ...makeRawSecretsContext(),
      get: async (_tenantId, _key, audit) => {
        audits.push(audit);
        return undefined;
      },
    };
    const wrapped = requireSecretsContext(
      { secrets: raw, user: { id: "caller-user" } },
      "secrets:write:set",
    );
    await wrapped.get(
      "tenant-x" as Parameters<SecretsContext["get"]>[0],
      "any-key" as unknown as Parameters<SecretsContext["get"]>[1],
    );
    expect(audits).toEqual([{ userId: "caller-user", handlerName: "secrets:write:set" }]);
  });

  test("throws when secrets is missing (boot-Misconfig)", () => {
    const fileProviderCtx = {
      secrets: undefined,
      auditUserId: SYSTEM_USER_ID,
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).toThrow(
      /ctx\.services\.secrets missing/,
    );
  });

  test("audit-userId reaches secrets.get when call is delegated", async () => {
    // Pins the audit path: when a plugin calls secrets.get(...), auditUserId is
    // passed through as audit.userId without an override. This is why
    // SYSTEM_USER_ID must not be replaced with an ad hoc magic string; otherwise,
    // the audit trail becomes inconsistent.
    const raw = makeRawSecretsContext();
    const ctx = {
      secrets: raw,
      auditUserId: SYSTEM_USER_ID,
    };
    const wrapped = requireSecretsContext(ctx, "user-data-rights:run-export-jobs");
    await wrapped.get(
      "tenant-x" as Parameters<SecretsContext["get"]>[0],
      "any-key" as unknown as Parameters<SecretsContext["get"]>[1],
    );
    // Erste-Aufruf-args: [tenantId, key, audit-Object]
    // biome-ignore lint/suspicious/noExplicitAny: Bun mock API requires any cast
    const audit = (raw.get as any).mock.calls[0]?.[2];
    expect(audit).toEqual({
      userId: SYSTEM_USER_ID,
      handlerName: "user-data-rights:run-export-jobs",
    });
  });
});
