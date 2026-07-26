// Shared fixture for run-prod-app-{dry-run,env-source}.test.ts — both boot
// runProdApp against a minimal probe feature with process.env cleared so the
// test fully controls config via envSource. Table/feature name stay
// parametrized (never collapsed to one shared fixture): a table clash
// between the two test files' entities would surface as flaky cross-file
// DB state, not a compile error.
import { afterEach, beforeEach } from "bun:test";
import {
  createBooleanField,
  createEntity,
  createTextField,
  defineFeature,
  type FeatureDefinition,
  type FeatureRegistrar,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

export function makeProbeFeature(opts: {
  readonly name: string;
  readonly table: string;
  readonly extraSetup?: (r: FeatureRegistrar<string>) => void;
}): FeatureDefinition {
  const probeEntity = createEntity({
    fields: {
      name: createTextField({ required: true }),
      active: createBooleanField({ default: true }),
    },
    table: opts.table,
  });
  return defineFeature(opts.name, (r) => {
    r.entity("widget", probeEntity);
    opts.extraSetup?.(r);
    r.queryHandler({
      name: "ping",
      schema: z.object({}),
      access: { roles: ["anonymous"] },
      handler: async () => ({ pong: true }),
    });
  });
}

// DATABASE_URL/REDIS_URL/JWT_SECRET are required (their read throws
// pre-#1441-fix boot bugs); PORT is non-throwing, cleared only so ambient
// PORT can't mask an "envSource wins" assertion.
export const CLEARED_BOOT_VARS = ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "PORT"] as const;

// Registers beforeEach/afterEach for the current describe block — call this
// at the top of a `describe(...)` body, same as calling beforeEach directly.
export function withClearedBootEnv(): void {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of CLEARED_BOOT_VARS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of CLEARED_BOOT_VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}
