// V1 — GDPR storage-persistence boot guard. Catches the prod failure class:
// user-data-rights mounted but exports land in an ephemeral / missing store,
// and s3-env selected as the GDPR store without its env vars set.
// V2 — export-without-erase guard. Catches features that register an export
// hook but no delete hook (Art.17 violation).

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  validateGdprHookCompleteness,
  validateGdprStoragePersistence,
} from "../boot-validator/gdpr-storage";
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

describe("validateGdprHookCompleteness (V2)", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const exportFn = async () => null;
  const deleteFn = async () => {};

  test("export + delete hooks → no warn", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension("userData", "myEntity", { export: exportFn, delete: deleteFn });
    });
    validateGdprHookCompleteness([f]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("export hook without delete hook → Art.17 warn", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension("userData", "myEntity", { export: exportFn });
    });
    validateGdprHookCompleteness([f]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = String(warnSpy.mock.calls[0]?.[0]);
    expect(msg).toContain("my-feature");
    expect(msg).toContain("myEntity");
    expect(msg).toContain("Art.17");
  });

  test("delete hook only (no export) → no warn", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension("userData", "myEntity", { delete: deleteFn });
    });
    validateGdprHookCompleteness([f]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("no EXT_USER_DATA hooks at all → no warn", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension("fileProvider", "s3");
    });
    validateGdprHookCompleteness([f]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("multiple features, one missing delete → one warn per missing hook", () => {
    const good = defineFeature("good", (r) => {
      r.useExtension("userData", "entityA", { export: exportFn, delete: deleteFn });
    });
    const bad = defineFeature("bad", (r) => {
      r.useExtension("userData", "entityB", { export: exportFn });
    });
    validateGdprHookCompleteness([good, bad]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain("entityB");
  });
});
