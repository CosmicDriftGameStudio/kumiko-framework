import type { UiHints } from "@cosmicdrift/kumiko-types/feature";
import type { FeatureRegistrar } from "@cosmicdrift/kumiko-types/feature-registrar";
import type { HookMap } from "@cosmicdrift/kumiko-types/hooks";
import { createInitialFeatureBuilderState } from "./feature-builder-state.ts";
import { buildConfigEventsJobsMethods } from "./feature-config-events-jobs.ts";
import { buildEntityHandlerMethods } from "./feature-entity-handlers.ts";
import { buildProbeMethods } from "./feature-probes.ts";
import { buildUiExtensionsMethods } from "./feature-ui-extensions.ts";
import { isObjectArgument, throwObjectArgumentRequired, unwrapArrayForm } from "./object-form.ts";
import type { FeatureDefinition } from "./types/index.ts";

// `TExports` lets the setup callback hand back a typed object that
// downstream features can import (e.g. `tenantFeature.exports.config`). The
// runtime always packs whatever setup returns into `featureDef.exports` —
// `void` returns become `undefined` and stay invisible at the call site.
//
// `TName` (with `const` inference) captures the literal feature-name from
// the call-site (`defineFeature("driverOrders", ...)` → TName="driverOrders").
// The literal threads into the FeatureRegistrar so r.defineEvent's return
// carries `name: "driver-orders:event:foo"` as a literal — strict-mode
// for `ctx.events.append({ type: eventDef.name, ... })` lights up. Apps
// that don't care can keep the default-string and use the wrapper-based
// strict-mode (string-literal types per call-site) like before.

// optionalRequires accepts either variadic strings or a single `{ features }` object; requires
// takes only the object (see RequiresApi).
function resolveFeatureNamesArgs(
  args: readonly [{ readonly features: readonly string[] }] | readonly string[],
): readonly string[] {
  return unwrapArrayForm(args, "features");
}

export type DefineFeatureSettings = {
  readonly dedupeOptions?: Readonly<Record<string, unknown>>;
};

// dedupe-features compares options with Object.is per key, so a nested object
// would make two structurally identical mounts look different and fail the boot
// with an unobvious "mounted twice with different options".
function assertDedupeOptionsComparable(
  featureName: string,
  options: Readonly<Record<string, unknown>> | undefined,
): void {
  for (const [key, value] of Object.entries(options ?? {})) {
    if (typeof value === "object" && value !== null) {
      throw new Error(
        `[Feature ${featureName}] dedupeOptions.${key} must be a primitive or a stable function reference; dedupeOptions are compared shallowly, so a nested object never matches a second mount`,
      );
    }
  }
}

export function defineFeature<const TName extends string, TExports = undefined>(
  name: TName,
  setup: (r: FeatureRegistrar<TName>) => TExports,
  settings?: DefineFeatureSettings,
): FeatureDefinition & { readonly exports: TExports } {
  assertDedupeOptionsComparable(name, settings?.dedupeOptions);
  const state = createInitialFeatureBuilderState();

  const registrar: FeatureRegistrar<TName> = {
    systemScope(): void {
      state.isSystemScoped = true;
    },
    describe(text: string): void {
      if (state.description !== undefined) {
        throw new Error(
          `[Feature ${name}] r.describe() called twice — a feature's description is declared once`,
        );
      }
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error(`[Feature ${name}] r.describe(): text must be a non-empty string`);
      }
      state.description = text.trim();
    },
    requires: (() => {
      const fn = (...args: readonly [{ readonly features: readonly string[] }]) => {
        const [first, ...rest] = args;
        if (rest.length > 0 || !isObjectArgument(first)) {
          throwObjectArgumentRequired(name, "requires");
        }
        // Untyped callers can pass `{ feature: [...] }`; without this the object would be
        // registered as a dependency name.
        if (!Array.isArray(first.features) || !first.features.every((f) => typeof f === "string")) {
          throw new Error(`[Feature ${name}] r.requires() needs { features: string[] }`);
        }
        state.requires.push(...first.features);
      };
      return Object.assign(fn, {
        projection: (tableName: string) => {
          state.requiredProjections.add(tableName);
        },
        step: (stepKind: string) => {
          state.requiredSteps.add(stepKind);
        },
      });
    })(),
    optionalRequires(
      ...args: readonly [{ readonly features: readonly string[] }] | readonly string[]
    ): void {
      state.optionalRequires.push(...resolveFeatureNamesArgs(args));
    },
    toggleable(options: { default: boolean }): void {
      if (state.toggleableDefault !== undefined) {
        throw new Error(
          `[Feature ${name}] r.toggleable() called twice — a feature's toggleable status is declared once`,
        );
      }
      state.toggleableDefault = options.default;
    },
    adoptsBundledLists(): void {
      state.adoptsBundledLists = true;
    },
    uiHints(hints: UiHints): void {
      if (state.uiHints !== undefined) {
        throw new Error(`[Feature ${name}] r.uiHints() called twice — UI hints are declared once`);
      }
      state.uiHints = hints;
    },
    ...buildEntityHandlerMethods(state, name),
    ...buildConfigEventsJobsMethods(state, name),
    ...buildUiExtensionsMethods(state, name),
    ...buildProbeMethods(state, name),
  };

  const exports = setup(registrar) as TExports; // @cast-boundary engine-bridge

  return {
    name,
    ...(state.description !== undefined && { description: state.description }),
    systemScope: state.isSystemScoped,
    exports,
    requires: state.requires,
    optionalRequires: state.optionalRequires,
    requiredProjections: state.requiredProjections,
    requiredSteps: state.requiredSteps,
    ...(state.toggleableDefault !== undefined && { toggleableDefault: state.toggleableDefault }),
    ...(state.adoptsBundledLists && { adoptsBundledLists: true as const }),
    ...(state.uiHints !== undefined && { uiHints: state.uiHints }),
    entities: state.entities,
    entityTables: state.entityTables,
    relations: state.relations,
    writeHandlers: state.writeHandlers,
    queryHandlers: state.queryHandlers,
    streamHandlers: state.streamHandlers,
    translations: state.translations,
    hooks: {
      validation: state.validationHooks,
      preSave: state.lifecycleHooks["preSave"] ?? {},
      postSave: state.phasedLifecycleHooks.postSave,
      preDelete: state.phasedLifecycleHooks.preDelete,
      postDelete: state.phasedLifecycleHooks.postDelete,
      postQuery: state.lifecycleHooks["postQuery"] ?? {},
      // @cast-boundary engine-bridge — hook registration erases the per-slot
      // signatures to LifecycleHookFn (a union; see the cast in
      // addLifecycleHook). The branches there are the only producers and write
      // the correct type for each slot.
    } as HookMap,
    entityHooks: {
      postSave: state.entityPostSave,
      preDelete: state.entityPreDelete,
      postDelete: state.entityPostDelete,
      postQuery: state.entityPostQuery,
    },
    searchPayloadExtensions: state.searchPayloadExtensions,
    configKeys: state.configKeys,
    configSeeds: state.configSeeds,
    jobs: state.jobs,
    notifications: state.notifications,
    registrarExtensions: state.registrarExtensions,
    extensionUsages: state.extensionUsages,
    extensionSelectors: state.extensionSelectors,
    exposedApis: state.exposedApis,
    usedApis: state.usedApis,
    bootChecks: state.bootChecks,
    referenceData: state.referenceData,
    events: state.events,
    eventMigrations: state.eventMigrations,
    configReads: state.configReads,
    handlerEntityMappings: state.handlerEntityMappings,
    metrics: state.metrics,
    secretKeys: state.secretKeys,
    secretNamespaces: state.secretNamespaces,
    ...(Object.keys(state.probes).length > 0 && { probes: state.probes }),
    projections: state.projections,
    entityProjectionExtensions: state.entityProjectionExtensions,
    multiStreamProjections: state.multiStreamProjections,
    authClaimsHooks: state.authClaimsHooks,
    claimKeys: state.claimKeys,
    screens: state.screens,
    navs: state.navs,
    contentCollections: state.contentCollections,
    workspaces: state.workspaces,
    httpRoutes: state.httpRoutes,
    webSocketRoutes: state.webSocketRoutes,
    storeTables: state.storeTables,
    ...(state.treeActions !== undefined && { treeActions: state.treeActions }),
    ...(state.envSchema !== undefined && { envSchema: state.envSchema }),
    ...(settings?.dedupeOptions !== undefined && { dedupeOptions: settings.dedupeOptions }),
  };
}
