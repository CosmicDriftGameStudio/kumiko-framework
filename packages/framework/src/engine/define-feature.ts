import { createInitialFeatureBuilderState } from "./feature-builder-state";
import { buildConfigEventsJobsMethods } from "./feature-config-events-jobs";
import { buildEntityHandlerMethods } from "./feature-entity-handlers";
import { buildUiExtensionsMethods } from "./feature-ui-extensions";
import type { FeatureDefinition, FeatureRegistrar, HookMap, UiHints } from "./types";
import type { RequiresApi } from "./types/feature";

// `TExports` lets the setup callback hand back a typed object that
// downstream features can import (e.g. `tenantFeature.exports.config`). The
// runtime always packs whatever setup returns into `featureDef.exports` —
// `void` returns become `undefined` and stay invisible at the call site.
//
// `TName` (with `const` inference) captures the literal feature-name from
// the call-site (`defineFeature("driverOrders", ...)` → TName="driverOrders").
// The literal threads into the FeatureRegistrar so r.defineEvent's return
// carries `name: "driver-orders:event:foo"` as a literal — strict-mode
// for `ctx.appendEvent({ type: eventDef.name, ... })` lights up. Apps
// that don't care can keep the default-string and use the wrapper-based
// strict-mode (string-literal types per call-site) like before.

export function defineFeature<const TName extends string, TExports = undefined>(
  name: TName,
  setup: (r: FeatureRegistrar<TName>) => TExports,
): FeatureDefinition & { readonly exports: TExports } {
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
      const fn = (
        ...args: string[] | [string, { apis: readonly string[] }]
      ) => {
        const [first, second] = args;
        if (typeof second === "object" && second !== null) {
          // Self-usage (feature calls its own exposed API) never needs a
          // self-requires — same exemption api-ext.ts grants at boot; a
          // self-requires would also trip the circular-dep validator.
          if (first !== name) {
            state.requires.push(first as string);
          }
          for (const apiName of second.apis) {
            state.usedApis.add(apiName);
          }
          return;
        }
        state.requires.push(...(args as string[]));
      };
      fn.projection = (tableName: string) => {
        state.requiredProjections.add(tableName);
      };
      fn.step = (stepKind: string) => {
        state.requiredSteps.add(stepKind);
      };
      return fn as RequiresApi;
    })(),
    optionalRequires(
      ...args: string[] | [string, { apis: readonly string[] }]
    ): void {
      const [first, second] = args;
      if (typeof second === "object" && second !== null) {
        if (first !== name) {
          state.optionalRequires.push(first as string);
        }
        for (const apiName of second.apis) {
          state.usedApis.add(apiName);
        }
        return;
      }
      state.optionalRequires.push(...(args as string[]));
    },
    toggleable(options: { default: boolean }): void {
      if (state.toggleableDefault !== undefined) {
        throw new Error(
          `[Feature ${name}] r.toggleable() called twice — a feature's toggleable status is declared once`,
        );
      }
      state.toggleableDefault = options.default;
    },
    uiHints(hints: UiHints): void {
      if (state.uiHints !== undefined) {
        throw new Error(`[Feature ${name}] r.uiHints() called twice — UI hints are declared once`);
      }
      state.uiHints = hints;
    },
    ...buildEntityHandlerMethods(state, name, () => registrar),
    ...buildConfigEventsJobsMethods(state, name),
    ...buildUiExtensionsMethods(state, name),
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
    ...(state.uiHints !== undefined && { uiHints: state.uiHints }),
    entities: state.entities,
    entityTables: state.entityTables,
    relations: state.relations,
    writeHandlers: state.writeHandlers,
    queryHandlers: state.queryHandlers,
    translations: state.translations,
    hooks: {
      validation: state.validationHooks,
      preSave: state.lifecycleHooks["preSave"] ?? {},
      postSave: state.phasedLifecycleHooks.postSave,
      preDelete: state.phasedLifecycleHooks.preDelete,
      postDelete: state.phasedLifecycleHooks.postDelete,
      preQuery: state.lifecycleHooks["preQuery"] ?? {},
      postQuery: state.lifecycleHooks["postQuery"] ?? {},
      // @cast-boundary engine-bridge — die Hook-Registrierung erased die
      // per-Slot-Signaturen zu LifecycleHookFn (Union, s. Cast in
      // addLifecycleHook); die Branches dort sind die einzigen Producer und
      // schreiben pro Slot typrichtig.
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
    referenceData: state.referenceData,
    events: state.events,
    eventMigrations: state.eventMigrations,
    configReads: state.configReads,
    handlerEntityMappings: state.handlerEntityMappings,
    metrics: state.metrics,
    secretKeys: state.secretKeys,
    projections: state.projections,
    entityProjectionExtensions: state.entityProjectionExtensions,
    multiStreamProjections: state.multiStreamProjections,
    authClaimsHooks: state.authClaimsHooks,
    claimKeys: state.claimKeys,
    screens: state.screens,
    navs: state.navs,
    workspaces: state.workspaces,
    httpRoutes: state.httpRoutes,
    rawTables: state.rawTables,
    unmanagedTables: state.unmanagedTables,
    ...(state.treeActions !== undefined && { treeActions: state.treeActions }),
    ...(state.envSchema !== undefined && { envSchema: state.envSchema }),
  };
}
