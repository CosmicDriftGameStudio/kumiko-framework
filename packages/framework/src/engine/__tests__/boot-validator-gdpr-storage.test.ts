// V1 — GDPR storage-persistence boot guard. Catches the prod failure class:
// user-data-rights mounted but exports land in an ephemeral / missing store,
// and s3-env selected as the GDPR store without its env vars set.
//
// V2-V4 (export-without-erase / PII-entity-without-hook / tenantOwned-entity-
// without-hook) moved off this framework-internal validator onto
// `r.bootCheck()` calls declared by user-data-rights / user-data-rights-
// defaults (#1314) — see boot-checks.test.ts in the bundled-features package
// for their coverage.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { validateGdprStoragePersistence } from "../boot-validator/gdpr-storage";
import { defineFeature } from "../define-feature";

const udr = () => defineFeature("user-data-rights", () => {});
const fileProvider = (name: string) =>
  defineFeature(`file-provider-${name}`, (r) => {
    r.useExtension("fileProvider", name);
  });

const S3_ENV = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

describe("validateGdprStoragePersistence (V1)", () => {
  let warnSpy: ReturnType<typeof spyOn>;
  let savedEnv: Array<readonly [string, string | undefined]>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    savedEnv = S3_ENV.map((k) => [k, process.env[k]] as const);
    for (const k of S3_ENV) delete process.env[k];
  });

  afterEach(() => {
    warnSpy.mockRestore();
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("no user-data-rights → never warns", () => {
    validateGdprStoragePersistence([fileProvider("inmemory")]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("user-data-rights + only inmemory → ephemeral-store warn", () => {
    validateGdprStoragePersistence([udr(), fileProvider("inmemory")]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("LOST on restart");
  });

  test("user-data-rights + no file provider at all → ephemeral-store warn", () => {
    validateGdprStoragePersistence([udr()]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("user-data-rights + s3 provider → no warn", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3")]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("user-data-rights + s3-env, env missing → s3-env env warn naming the vars", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3-env")]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toContain("S3_BUCKET");
    expect(msg).toContain("s3-env");
  });

  test("user-data-rights + s3-env, env set → no warn", () => {
    for (const k of S3_ENV) process.env[k] = "x";
    validateGdprStoragePersistence([udr(), fileProvider("s3-env")]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("user-data-rights + s3 AND s3-env (use-all-bundled shape) → no warn even with env unset", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3"), fileProvider("s3-env")]);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
