import { describe, expect, test } from "bun:test";
import {
  AccessDeniedError,
  ConflictError,
  FeatureDisabledError,
  InternalError,
  NotFoundError,
  RateLimitError,
  UnconfiguredError,
  UniqueViolationError,
  UnprocessableError,
  ValidationError,
  VersionConflictError,
} from "@cosmicdrift/kumiko-framework/errors";
import { kumikoDefaultTranslations } from "../i18n-defaults";

// Keys are read off LIVE error instances, not a hardcoded list — a copied list
// would mirror the bundle and never catch a renamed i18nKey or a new error
// class shipped without a default translation. Ship an 11th error class (or
// rename a key) without adding the default → this fails.
const errorInstances = [
  new InternalError(),
  new AccessDeniedError(),
  new NotFoundError("Thing"),
  new ConflictError(),
  new VersionConflictError({ entityId: 1, expectedVersion: 1, currentVersion: 2 }),
  new UniqueViolationError({ entityName: "Thing" }),
  new UnprocessableError("reason"),
  new UnconfiguredError({ feature: "f", key: "k" }),
  new FeatureDisabledError("f", "h"),
  new RateLimitError({
    bucket: "b",
    limit: 1,
    windowSeconds: 1,
    remaining: 0,
    retryAfterSeconds: 1,
    resetAt: "1970-01-01T00:00:00Z",
  }),
  new ValidationError({ fields: [] }),
];

const de = kumikoDefaultTranslations["de"];
const en = kumikoDefaultTranslations["en"];

describe("kumikoDefaultTranslations covers every error i18nKey", () => {
  for (const e of errorInstances) {
    test(`${e.code} → ${e.i18nKey} has de+en default`, () => {
      expect(de?.[e.i18nKey]).toBeTruthy();
      expect(en?.[e.i18nKey]).toBeTruthy();
    });
  }

  // Client-emitted (renderer-web download helper) — not thrown by a class, but
  // rendered through the same last-resort bundle. Gap #5 named it explicitly.
  test("errors.download.urlMissing has de+en default", () => {
    expect(de?.["errors.download.urlMissing"]).toBeTruthy();
    expect(en?.["errors.download.urlMissing"]).toBeTruthy();
  });

  // Client-emitted (dispatcher-live error-mapping) — network/abort never
  // reach the server, so no error class mints these; still rendered through
  // this last-resort bundle whenever a feature reads res.error.i18nKey raw.
  test("dispatcher.errors.network has de+en default", () => {
    expect(de?.["dispatcher.errors.network"]).toBeTruthy();
    expect(en?.["dispatcher.errors.network"]).toBeTruthy();
  });

  test("dispatcher.errors.aborted has de+en default", () => {
    expect(de?.["dispatcher.errors.aborted"]).toBeTruthy();
    expect(en?.["dispatcher.errors.aborted"]).toBeTruthy();
  });
});
