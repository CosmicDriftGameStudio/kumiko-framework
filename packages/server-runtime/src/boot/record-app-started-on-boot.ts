import { hostname } from "node:os";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  APP_INSTANCE_STREAM_TYPE,
  APP_STARTED_EVENT_TYPE,
  append,
} from "@cosmicdrift/kumiko-framework/event-store";
import { createFallbackLogger } from "@cosmicdrift/kumiko-framework/logging";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { SYSTEM_TENANT_ID, SYSTEM_USER_ID } from "@cosmicdrift/kumiko-types/identifiers";

export const APP_VERSION_ENV = "KUMIKO_APP_VERSION";
export const GIT_COMMIT_ENV = "KUMIKO_GIT_COMMIT";
export const INSTANCE_ID_ENV = "KUMIKO_INSTANCE_ID";
export const HOSTNAME_ENV = "HOSTNAME";
export const UNKNOWN_APP_VERSION = "unknown";

type EnvSource = Readonly<Record<string, string | undefined>>;

export type AppStartedPayload = {
  readonly version: string;
  readonly commit?: string;
  readonly instanceId: string;
  readonly startedAt: string;
};

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

export function resolveAppStartedPayload(
  envSource: EnvSource,
  fallbackHostname: string,
  startedAt: string,
): AppStartedPayload {
  const commit = nonEmpty(envSource[GIT_COMMIT_ENV]);
  return {
    version: nonEmpty(envSource[APP_VERSION_ENV]) ?? UNKNOWN_APP_VERSION,
    ...(commit !== undefined ? { commit } : {}),
    instanceId:
      nonEmpty(envSource[INSTANCE_ID_ENV]) ?? nonEmpty(envSource[HOSTNAME_ENV]) ?? fallbackHostname,
    startedAt,
  };
}

// Audit trail only: a failed append must never keep the app from booting.
export async function recordAppStartedOnBoot(opts: {
  readonly db: DbConnection;
  readonly envSource: EnvSource;
}): Promise<void> {
  const payload = resolveAppStartedPayload(
    opts.envSource,
    hostname(),
    Temporal.Now.instant().toString(),
  );
  try {
    await append(opts.db, {
      aggregateId: generateId(),
      aggregateType: APP_INSTANCE_STREAM_TYPE,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: APP_STARTED_EVENT_TYPE,
      payload,
      metadata: { userId: SYSTEM_USER_ID },
    });
  } catch (e: unknown) {
    createFallbackLogger("app-started").warn(
      "Could not record app.started event; continuing boot",
      {
        version: payload.version,
        error: e instanceof Error ? e.message : String(e),
      },
    );
  }
}
