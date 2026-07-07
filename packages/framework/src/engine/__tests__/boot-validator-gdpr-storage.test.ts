// V1 — GDPR storage-persistence boot guard. Catches the prod failure class:
// user-data-rights mounted but exports land in an ephemeral / missing store,
// and s3-env selected as the GDPR store without its env vars set.
// V2 — export-without-erase guard. Catches features that register an export
// hook but no delete hook (Art.17 violation).
// V3 — PII-entity-without-hook guard. Catches entities with pii/userOwned
// fields that no feature registers an EXT_USER_DATA hook for.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  validateGdprHookCompleteness,
  validateGdprPiiHookCoverage,
  validateGdprStoragePersistence,
} from "../boot-validator/gdpr-storage";
import { defineFeature } from "../define-feature";
import { EXT_USER_DATA } from "../extension-names";
import { createEntity, createLongTextField, createTextField } from "../factories";

const udr = () => defineFeature("user-data-rights", () => {});
const fileProvider = (name: string) =>
  defineFeature(`file-provider-${name}`, (r) => {
    r.useExtension("fileProvider", name);
  });

const S3_ENV = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const;

// V2/V3 are hard boot gates now — capture the thrown message so a single case
// can assert several substrings (feature, entity, article).
function catchMessage(fn: () => void): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected function to throw, but it did not");
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
  const exportFn = async () => null;
  const deleteFn = async () => {};

  test("export + delete hooks → no throw", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension(EXT_USER_DATA, "myEntity", { export: exportFn, delete: deleteFn });
    });
    expect(() => validateGdprHookCompleteness([f])).not.toThrow();
  });

  test("export hook without delete hook → Art.17 throw", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension(EXT_USER_DATA, "myEntity", { export: exportFn });
    });
    const msg = catchMessage(() => validateGdprHookCompleteness([f]));
    expect(msg).toContain("my-feature");
    expect(msg).toContain("myEntity");
    expect(msg).toContain("Art.17");
  });

  test("delete hook only (no export) → no throw", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension(EXT_USER_DATA, "myEntity", { delete: deleteFn });
    });
    expect(() => validateGdprHookCompleteness([f])).not.toThrow();
  });

  test("no EXT_USER_DATA hooks at all → no throw", () => {
    const f = defineFeature("my-feature", (r) => {
      r.useExtension("fileProvider", "s3");
    });
    expect(() => validateGdprHookCompleteness([f])).not.toThrow();
  });

  test("multiple features, one missing delete → throws naming the offender", () => {
    const good = defineFeature("good", (r) => {
      r.useExtension(EXT_USER_DATA, "entityA", { export: exportFn, delete: deleteFn });
    });
    const bad = defineFeature("bad", (r) => {
      r.useExtension(EXT_USER_DATA, "entityB", { export: exportFn });
    });
    const msg = catchMessage(() => validateGdprHookCompleteness([good, bad]));
    expect(msg).toContain("entityB");
  });
});

describe("validateGdprPiiHookCoverage (V3)", () => {
  const exportFn = async () => null;
  const deleteFn = async () => {};

  const piiFeature = () =>
    defineFeature("crm", (r) => {
      r.entity(
        "contact",
        createEntity({
          fields: {
            email: createTextField({ pii: true }),
            note: createLongTextField({ userOwned: { ownerField: "authorId" } }),
            authorId: { type: "reference", entity: "user" },
          },
        }),
      );
    });

  test("user-data-rights not mounted → no throw", () => {
    expect(() => validateGdprPiiHookCoverage([piiFeature()])).not.toThrow();
  });

  test("pii entity without any EXT_USER_DATA hook → throws naming entity and fields", () => {
    const msg = catchMessage(() => validateGdprPiiHookCoverage([udr(), piiFeature()]));
    expect(msg).toContain('"contact"');
    expect(msg).toContain("email");
    expect(msg).toContain("note");
    expect(msg).toContain("Art.17");
  });

  test("pii entity with hook registered by another feature → no throw", () => {
    const hooks = defineFeature("crm-user-data", (r) => {
      r.useExtension(EXT_USER_DATA, "contact", { export: exportFn, delete: deleteFn });
    });
    expect(() => validateGdprPiiHookCoverage([udr(), piiFeature(), hooks])).not.toThrow();
  });

  test("no-op hook is the intentional escape hatch → no throw", () => {
    const hooks = defineFeature("crm-user-data", (r) => {
      // Escape hatch: erasure handled elsewhere (crypto-shredding key-erase),
      // so the pipeline hook is a deliberate no-op.
      r.useExtension(EXT_USER_DATA, "contact", {
        export: async () => null,
        delete: async () => {},
      });
    });
    expect(() => validateGdprPiiHookCoverage([udr(), piiFeature(), hooks])).not.toThrow();
  });

  test("entity without subject annotations → no throw", () => {
    const plain = defineFeature("catalog", (r) => {
      r.entity(
        "product",
        createEntity({
          fields: { sku: createTextField({ allowPlaintext: "is-business-data" }) },
        }),
      );
    });
    expect(() => validateGdprPiiHookCoverage([udr(), plain])).not.toThrow();
  });

  test("userOwned field alone counts as user-subject data → throws", () => {
    const f = defineFeature("notes", (r) => {
      r.entity(
        "note",
        createEntity({
          fields: {
            body: createLongTextField({ userOwned: { ownerField: "authorId" } }),
            authorId: { type: "reference", entity: "user" },
          },
        }),
      );
    });
    const msg = catchMessage(() => validateGdprPiiHookCoverage([udr(), f]));
    expect(msg).toContain('"note"');
  });
});
