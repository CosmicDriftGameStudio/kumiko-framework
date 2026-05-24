// requireSecretsContext-Surface-Tests (S2.U3 Atom 3b.fix2).
//
// Pinst dass `requireSecretsContext` mit dem schmalen FileProviderContext-
// Surface funktioniert — nicht nur mit voller HandlerContext.
// Regression-Pin fuer den latenten Worker-Pfad-Bug:
//   - Vor 3b.fix wurde `ctx as unknown as HandlerContext` durchgereicht
//   - Im Worker-Pfad ist `ctx._userId` undefined (dispatcher setzt es nur
//     im request-Pfad), also throw `_userId missing`
//   - Fix: Worker-Wrap setzt explizit `_userId: SYSTEM_USER_ID`
//
// Der Test inszeniert beide Surfaces (HandlerContext-shape via type-assert
// + FileProviderContext-shape direkt) und prueft dass beide den happy-path
// + den fehlt-_userId-throw durchlaufen.

import { describe, expect, mock, test } from "bun:test";
import { SYSTEM_USER_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { SecretsContext } from "@cosmicdrift/kumiko-framework/secrets";
import { requireSecretsContext } from "../feature";

function makeRawSecretsContext(): SecretsContext {
  return {
    get: mock(),
    set: mock(),
    delete: mock(),
  };
}

describe("requireSecretsContext :: FileProviderContext surface", () => {
  test("succeeds with secrets + _userId present (Worker-Pfad mit SYSTEM_USER_ID)", () => {
    const fileProviderCtx = {
      secrets: makeRawSecretsContext(),
      _userId: SYSTEM_USER_ID,
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).not.toThrow();
  });

  test("throws when _userId is missing (latenter Worker-Bug pre-3b.fix)", () => {
    // Pinst die Falle die der 3b.fix abfaengt: wenn ein Provider-Plugin
    // `requireSecretsContext` ruft und der ctx kein _userId hat (z.B. weil
    // ein r.job-Wrap das vergessen hat zu setzen), faellt es FRUEH mit
    // einer klaren Fehlermeldung um — nicht silent broken.
    const fileProviderCtx = {
      secrets: makeRawSecretsContext(),
      // _userId absichtlich undefined
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).toThrow(/_userId missing/);
  });

  test("throws when secrets is missing (boot-Misconfig)", () => {
    const fileProviderCtx = {
      _userId: SYSTEM_USER_ID,
      // secrets absichtlich undefined
    };
    expect(() => requireSecretsContext(fileProviderCtx, "test-handler")).toThrow(
      /ctx\.secrets missing/,
    );
  });

  test("audit-userId reaches secrets.get when call is delegated", async () => {
    // Pinst den Audit-Pfad: wenn ein Plugin secrets.get(...) aufruft, kommt
    // _userId als audit.userId ohne Override durch. Das ist der Grund warum
    // SYSTEM_USER_ID nicht durch einen ad-hoc-magic-string ersetzt werden
    // darf — sonst wird der Audit-Trail inkonsistent.
    const raw = makeRawSecretsContext();
    const ctx = {
      secrets: raw,
      _userId: SYSTEM_USER_ID,
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
