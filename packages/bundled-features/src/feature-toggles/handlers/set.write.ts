import { insertOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineWriteHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  UnprocessableError,
  VersionConflictError,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import {
  FEATURE_TOGGLE_AGGREGATE_TYPE,
  FEATURE_TOGGLE_SET_EVENT_NAME,
  FeatureToggleErrors,
} from "../constants";
import { updateFeatureToggleOptimistic } from "../db/queries/toggle-state";
import { globalFeatureStateTable } from "../global-feature-state-table";
import type { GlobalFeatureToggleRuntime } from "../toggle-runtime";

// Factory: binds a runtime accessor to the handler at registration time.
// The runtime holds the in-memory snapshot that the dispatcher's gate
// reads; every successful set() call must update it, otherwise the flip
// won't take effect until the next boot.
//
// Accessor form (instead of direct runtime ref) supports the bootstrapping
// flow: tests + setupTestStack construct the feature definition BEFORE the
// runtime exists (the runtime needs the registry, which setupTestStack
// builds from the features). The accessor is resolved lazily, at call time.
//
// `undefined` accessor is legitimate at registration-time for boot-mode
// smoke-apps (`KUMIKO_DRY_RUN_ENV=boot`) that never dispatch a set-call.
// We throw lazily on first call with an actionable message — `as
// GlobalFeatureToggleRuntime`-casts at the registration site are no
// longer needed.
export function createSetWriteHandler(getRuntime: (() => GlobalFeatureToggleRuntime) | undefined) {
  return defineWriteHandler({
    name: "set",
    schema: z.object({
      featureName: z.string().min(1),
      enabled: z.boolean(),
    }),
    // Platform-operator action — SystemAdmin only.
    access: { roles: ["SystemAdmin"] },
    handler: async (event, ctx) => {
      const { featureName, enabled } = event.payload;

      // Guard 1: featureName must be a registered feature. Otherwise we'd
      // pile up orphan rows from typos that the gate would silently apply
      // (if someone ever added a feature with that name later).
      const feature = ctx.registry.getFeature(featureName);
      if (!feature) {
        return writeFailure(
          new UnprocessableError(FeatureToggleErrors.unknownFeature, {
            i18nKey: "feature-toggles.errors.unknownFeature",
            details: { featureName },
          }),
        );
      }

      // Guard 2: feature must be toggleable. Non-toggleable features (auth,
      // tenant, user, feature-toggles itself) must stay on — the gate
      // would ignore any row, but writing one sends the wrong signal to
      // anyone reading the table.
      if (feature.toggleableDefault === undefined) {
        return writeFailure(
          new UnprocessableError(FeatureToggleErrors.notToggleable, {
            i18nKey: "feature-toggles.errors.notToggleable",
            details: { featureName },
          }),
        );
      }

      // Read current state for event payload + optimistic-lock version.
      // `$inferSelect` narrows the result shape to the real table schema —
      // no hand-rolled cast, no drift if a column is added later.
      type StateRow = {
        featureName: string;
        enabled: boolean;
        version: number;
        updatedAt: Temporal.Instant;
        updatedBy: string;
      };
      const [existing] = await selectMany<StateRow>(
        ctx.db,
        globalFeatureStateTable,
        { featureName },
        { limit: 1 },
      );

      const previousEnabled = existing?.enabled ?? null;

      if (!existing) {
        // First-time override: insert.
        await insertOne(ctx.db, globalFeatureStateTable, {
          featureName,
          enabled,
          version: 1,
          updatedBy: event.user.id,
          updatedAt: Temporal.Now.instant(),
        });
      } else {
        // Upsert with optimistic lock. Two operators flipping the same
        // toggle simultaneously is rare but possible — the version-WHERE
        // ensures only one wins; the loser sees VersionConflictError.
        const updated = await updateFeatureToggleOptimistic(ctx.db, {
          enabled,
          updatedBy: event.user.id,
          updatedAt: Temporal.Now.instant(),
          featureName,
          expectedVersion: existing.version,
        });

        if (updated.length === 0) {
          return writeFailure(
            new VersionConflictError({
              entityId: featureName,
              expectedVersion: existing.version,
              currentVersion: existing.version + 1,
            }),
          );
        }
      }

      // Domain event — the event-store IS the toggle-change audit trail.
      // aggregateId = SYSTEM_TENANT_ID (uuid) because the events table
      // types aggregate_id as uuid. Per-feature stream isolation would
      // need synthetic UUIDs from the feature-name, which add nothing
      // audit-wise; one shared toggle-changes stream per system is fine,
      // and filtering by payload.featureName is trivial at query time.
      // This mirrors how `config` handles the same constraint for
      // its config-changed events.
      // unsafeAppendEvent — bundled-features ohne lokalen Wrapper. Apps
      // mit `yarn kumiko codegen` kriegen `.kumiko/define.ts` als strict-
      // path; bundled-features bleibt bei der unsafe-Variante. Schema-
      // Validation läuft trotzdem via r.defineEvent("toggle-set", ...).
      await ctx.unsafeAppendEvent({
        aggregateId: SYSTEM_TENANT_ID,
        aggregateType: FEATURE_TOGGLE_AGGREGATE_TYPE,
        type: FEATURE_TOGGLE_SET_EVENT_NAME,
        payload: {
          featureName,
          enabled,
          previousEnabled,
          updatedBy: event.user.id,
        },
      });

      // Update the local in-memory snapshot. Done AFTER the DB write +
      // event append so a crash in either leaves the snapshot consistent
      // with what's persisted. This is the response-latency optimization:
      // the next request on THIS instance sees the flip without waiting
      // for a dispatcher tick. Other instances learn the change through
      // the `toggle-cache-sync` MSP (see feature-toggles-feature.ts). Both
      // paths are idempotent — Map.set is last-write-wins and the DB is
      // the source of truth after boot-time initialize().
      if (!getRuntime) {
        throw new Error(
          "[feature-toggles] set-handler called but createFeatureTogglesFeature " +
            "was wired up without `getRuntime`. Wire the accessor in your app-config " +
            "(production: `() => runtime` after buildServer; tests: createLateBoundHolder.get).",
        );
      }
      getRuntime().apply(featureName, enabled);

      return {
        isSuccess: true,
        data: { featureName, enabled, previousEnabled },
      };
    },
  });
}
