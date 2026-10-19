// requireSecretsContext-Surface-Tests (S2.U3 Atom 3b.fix2).
//
// Pinst dass `requireSecretsContext` mit dem schmalen FileProviderContext-
// Surface funktioniert — nicht nur mit voller HandlerContext.
// Regression-Pin fuer den latenten Worker-Pfad-Bug:
//   - Vor 3b.fix wurde `ctx as unknown as HandlerContext` durchgereicht
//   - Im Worker-Pfad ist `ctx.auditUserId` undefined (dispatcher setzt es nur
//     im request-Pfad), also throw `auditUserId missing`
//   - Fix: Worker-Wrap setzt explizit `auditUserId: SYSTEM_USER_ID`
//
// Der Test inszeniert beide Surfaces (HandlerContext-shape via type-assert
// + FileProviderContext-shape direkt) und prueft dass beide den happy-path
// + den fehlt-auditUserId-throw durchlaufen.

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
      // auditUserId absichtlich undefined
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
      auditUserId: SYSTEM_USER_ID,
      // secrets absichtlich undefined
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).toThrow(
      /ctx\.secrets missing/,
    );
  });

  test("audit-userId reaches secrets.get when call is delegated", async () => {
    // Pinst den Audit-Pfad: wenn ein Plugin secrets.get(...) aufruft, kommt
    // auditUserId als audit.userId ohne Override durch. Das ist der Grund warum
    // SYSTEM_USER_ID nicht durch einen ad-hoc-magic-string ersetzt werden
    // darf — sonst wird der Audit-Trail inkonsistent.
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
