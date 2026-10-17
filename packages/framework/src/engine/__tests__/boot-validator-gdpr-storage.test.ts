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
import { validateGdprStoragePersistence } from "../boot-validator/gdpr-storage.js";
import { defineFeature } from "../define-feature.js";

const udr = () => defineFeature("user-data-rights", () => {});
const fileProvider = (name: string) =>
  defineFeature(`file-provider-${name}`, (r) => {
    // build is never invoked here — the boot check only cares that a provider is mounted.
    r.useExtension("fileProvider", name, {
      build: async () => {
        throw new Error("test stub — never invoked");
      },
    });
  });

const S3_ENV = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

// Other test files in the same bun process emit async warnings while this spy is active,
// so "no warning" assertions only count the messages the validator under test produces.
function gdprWarnings(spy: {
  readonly mock: { readonly calls: ReadonlyArray<ReadonlyArray<unknown>> };
}) {
  return spy.mock.calls.filter((args) => args.some((arg) => String(arg).includes("GDPR")));
}

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
    expect(gdprWarnings(warnSpy)).toHaveLength(0);
  });

  test("user-data-rights + only inmemory → ephemeral-store warn", () => {
    validateGdprStoragePersistence([udr(), fileProvider("inmemory")]);
    const warnings = gdprWarnings(warnSpy);
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain("LOST on restart");
  });

  test("user-data-rights + no file provider at all → ephemeral-store warn", () => {
    validateGdprStoragePersistence([udr()]);
    expect(gdprWarnings(warnSpy)).toHaveLength(1);
  });

  test("user-data-rights + s3 provider → no warn", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3")]);
    expect(gdprWarnings(warnSpy)).toHaveLength(0);
  });

  test("user-data-rights + s3-env, env missing → s3-env env warn naming the vars", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3-env")]);
    const warnings = gdprWarnings(warnSpy);
    expect(warnings).toHaveLength(1);
    const msg = String(warnings[0]?.[0]);
    expect(msg).toContain("S3_BUCKET");
    expect(msg).toContain("s3-env");
  });

  test("user-data-rights + s3-env, env set → no warn", () => {
    for (const k of S3_ENV) process.env[k] = "x";
    validateGdprStoragePersistence([udr(), fileProvider("s3-env")]);
    expect(gdprWarnings(warnSpy)).toHaveLength(0);
  });

  test("user-data-rights + s3 AND s3-env (use-all-bundled shape) → no warn even with env unset", () => {
    validateGdprStoragePersistence([udr(), fileProvider("s3"), fileProvider("s3-env")]);
    expect(gdprWarnings(warnSpy)).toHaveLength(0);
  });
});
