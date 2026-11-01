import { describe, expect, test } from "bun:test";
import {
  AccessDeniedError,
  ConflictError,
  FeatureDisabledError,
  IdempotentReplayError,
  InternalError,
  MemberReadTimeoutError,
  NotFoundError,
  PreconditionFailedError,
  RateLimitError,
  RateLimitUnavailableError,
  RecordLockedError,
  UnauthenticatedError,
  UnconfiguredError,
  UniqueViolationError,
  UnprocessableError,
  ValidationError,
  VersionConflictError,
} from "../classes.ts";
import { frameworkErrorHttpStatus } from "../error-codes.ts";
import type { KumikoError } from "../kumiko-error.ts";

const errorInstances: readonly KumikoError[] = [
  new ValidationError({ fields: [] }),
  new FeatureDisabledError("feature", "handler"),
  new AccessDeniedError(),
  new UnauthenticatedError(),
  new NotFoundError("order", 1),
  new ConflictError(),
  new VersionConflictError({ entityId: 1, expectedVersion: 1, currentVersion: 2 }),
  new PreconditionFailedError({ entityId: 1, field: "status" }),
  new RecordLockedError({ entityName: "order", entityId: 1 }),
  new IdempotentReplayError({ idempotencyKey: "key" }),
  new UniqueViolationError({ entityName: "order" }),
  new UnprocessableError("reason"),
  new UnconfiguredError({ feature: "feature", key: "key" }),
  new InternalError(),
  new MemberReadTimeoutError({ timeoutMs: 1 }),
  new RateLimitError({
    bucket: "bucket",
    limit: 1,
    windowSeconds: 1,
    remaining: 0,
    retryAfterSeconds: 1,
    resetAt: "2026-01-01T00:00:00.000Z",
  }),
  new RateLimitUnavailableError(),
];

describe("frameworkErrorHttpStatus", () => {
  test("matches code and httpStatus of every framework error class", () => {
    const actual = Object.fromEntries(errorInstances.map((err) => [err.code, err.httpStatus]));
    expect(actual).toEqual(frameworkErrorHttpStatus);
  });

  test("has exactly one class per code", () => {
    expect(errorInstances.length).toBe(Object.keys(frameworkErrorHttpStatus).length);
  });
});
