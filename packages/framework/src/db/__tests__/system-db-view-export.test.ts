// createUncheckedSystemDb() is framework-private (not re-exported from
// db/index.ts); createSystemDbView is the public replacement, whose
// unsafeRaw follows the source TenantDb's own escapeHatch gate instead of
// handing out an ungated tenantDbRunner(db).

import { describe, expect, test } from "bun:test";
import * as dbBarrel from "@cosmicdrift/kumiko-framework/db";
import { createSystemDbView, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { AccessDeniedError } from "../../errors";
import { testTenantId } from "../../stack";
import type { DbRunner } from "../connection";
import { unsafeRawForDeclaredStep, withSystemDbUnsafeRawGrant } from "../tenant-db";

const tenantId = testTenantId(1);

function fakeRunner(): DbRunner {
  return {
    unsafe: async () => {
      throw new Error("system-db-view-export tests must not reach the DB");
    },
    begin: async () => {
      throw new Error("system-db-view-export tests must not reach the DB");
    },
  } as unknown as DbRunner;
}

describe("db barrel export", () => {
  test("createUncheckedSystemDb is no longer exported from @cosmicdrift/kumiko-framework/db", () => {
    expect("createUncheckedSystemDb" in dbBarrel).toBe(false);
  });
});

describe("createSystemDbView(...).unsafeRaw", () => {
  test("denies without a grant on the source TenantDb, without reporting on either side", () => {
    const sourceReports: Array<{ kind: string; reason: string }> = [];
    const viewReports: Array<{ kind: string; reason: string }> = [];
    const source = createTenantDb(
      fakeRunner(),
      tenantId,
      "tenant",
      undefined,
      undefined,
      undefined,
      { report: (kind, reason) => sourceReports.push({ kind, reason }) },
    );
    const view = createSystemDbView(source, undefined, (kind, reason) =>
      viewReports.push({ kind, reason }),
    );

    expect(() => view.unsafeRaw("x")).toThrow(AccessDeniedError);
    expect(sourceReports).toEqual([]);
    expect(viewReports).toEqual([]);
  });

  test("resolves to the source's own bound runner and reports through the source, not the view", () => {
    const runner = fakeRunner();
    const sourceReports: Array<{ kind: string; reason: string }> = [];
    const viewReports: Array<{ kind: string; reason: string }> = [];
    const source = createTenantDb(runner, tenantId, "tenant", undefined, undefined, undefined, {
      unsafeRaw: { reason: "handler declared unsafeRaw" },
      report: (kind, reason) => sourceReports.push({ kind, reason }),
    });
    const view = createSystemDbView(source, undefined, (kind, reason) =>
      viewReports.push({ kind, reason }),
    );

    expect(view.unsafeRaw("x")).toBe(runner);
    expect(sourceReports).toEqual([{ kind: "unsafe-raw", reason: "x" }]);
    expect(viewReports).toEqual([]);
  });

  test("memberReadOnly on the source denies even with an unsafeRaw grant", () => {
    const source = createTenantDb(
      fakeRunner(),
      tenantId,
      "tenant",
      undefined,
      undefined,
      undefined,
      { unsafeRaw: { reason: "handler declared unsafeRaw" }, memberReadOnly: true },
    );
    const view = createSystemDbView(source);

    expect(() => view.unsafeRaw("x")).toThrow(AccessDeniedError);
    expect(() => view.unsafeRaw("x")).toThrow(/read-only/);
  });
});

describe("unsafeRawForDeclaredStep(createSystemDbView(...))", () => {
  test("throws AccessDeniedError, not InternalError, without a grant on the source", () => {
    const source = createTenantDb(fakeRunner(), tenantId, "tenant");
    const view = createSystemDbView(source);

    expect(() => unsafeRawForDeclaredStep(view, "x")).toThrow(AccessDeniedError);
  });
});

describe("withSystemDbUnsafeRawGrant(createSystemDbView(...))", () => {
  test("returns the view unchanged — no rebind, so no rights upgrade over the source's own gate", () => {
    const source = createTenantDb(fakeRunner(), tenantId, "tenant");
    const view = createSystemDbView(source);

    const rebound = withSystemDbUnsafeRawGrant(view, { reason: "hook grant" }, "some hook");
    expect(rebound).toBe(view);
    expect(() => rebound.unsafeRaw("x")).toThrow(AccessDeniedError);
  });
});
