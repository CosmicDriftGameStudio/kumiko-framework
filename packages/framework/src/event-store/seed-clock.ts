/// <reference types="temporal-polyfill/global" preserve="true" />
import { AsyncLocalStorage } from "node:async_hooks";

export const SEED_MODE_ENV = "KUMIKO_TEST_SEED";

export class SeedModeDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedModeDisabledError";
  }
}

// The only mode switch: the e2e/demo seed flag, never under production.
export function isSeedModeEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env[SEED_MODE_ENV] === "1" && env["NODE_ENV"] !== "production";
}

// A server booted with the seed flag AND a production NODE_ENV is a
// misconfiguration that would leave back-dating half-armed; refuse to boot.
export function assertSeedModeNotInProduction(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env[SEED_MODE_ENV] === "1" && env["NODE_ENV"] === "production") {
    throw new SeedModeDisabledError(
      `${SEED_MODE_ENV}=1 is set together with NODE_ENV=production. Seed mode back-dates events and must never run in production; unset ${SEED_MODE_ENV}.`,
    );
  }
}

// Not part of requestContext on purpose: nothing parsed from a request can
// reach this store, only code that calls runSeedWritesAt in-process.
const seedClockStorage = new AsyncLocalStorage<{ readonly createdAt: Temporal.Instant }>();

/**
 * Runs `fn` so that every event appended inside it (through the normal write
 * path: handlers, validation, projections) is stored with `createdAt` instead
 * of the database `now()`. Throws without running `fn` unless seed mode is on.
 */
export async function runSeedWritesAt<T>(
  createdAt: Temporal.Instant,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isSeedModeEnabled()) {
    throw new SeedModeDisabledError(
      `runSeedWritesAt needs ${SEED_MODE_ENV}=1 and NODE_ENV!=="production"; nothing was written.`,
    );
  }
  return seedClockStorage.run({ createdAt }, fn);
}

/** Back-dated event time for the current scope, undefined outside runSeedWritesAt. */
export function currentSeedCreatedAt(): Temporal.Instant | undefined {
  const scope = seedClockStorage.getStore();
  if (scope === undefined) return undefined;
  if (!isSeedModeEnabled()) {
    throw new SeedModeDisabledError(
      "Seed scope is active but seed mode is off; refusing to back-date events.",
    );
  }
  return scope.createdAt;
}
