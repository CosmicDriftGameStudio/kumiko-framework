// FeaturePatcher — imperative typed wrapper around the generic apply API.
// Each `add{Kind}` method takes the natural arguments for that pattern
// (no SourceLocation gymnastics, no FeaturePattern hand-crafting) and
// dispatches through the renderer + addPattern under the hood.
//
// **Why this layer exists:**
//   - **AI tool-use**: an LLM-with-tools picks methods by name. `addEntity`
//     with typed args is a 1-shot tool-call; building a FeaturePattern
//     literal in JSON would require teaching the model our internal
//     discriminated-union shape (kind + source + entityName + definition).
//   - **Designer forms**: form-submit handlers map directly to a single
//     `patcher.addX(formData)` call — no intermediary translation step.
//   - **Type narrowing**: each method's TypeScript signature locks the
//     fields the caller must provide; missing required props fail at
//     compile time, not at the parse step downstream.
//
// **What stays in the generic API:**
//   - `replace(id, pattern)` / `remove(id)` — symmetric across kinds; the
//     PatternId discriminator already names what to match.
//   - `apply(changes)` — bulk operations, friendlier when the AI emits a
//     change-list as a single JSON array.

import type { SourceFile } from "ts-morph";
import type { LifecycleHookType } from "../constants";
import type {
  ConfigKeyDefinition,
  ConfigKeyType,
  JobDefinition,
  RunIn,
  TranslationKeys,
} from "../types/config";
import type { MetricOptions, SecretOptions } from "../types/feature";
import type { EntityDefinition } from "../types/fields";
import type { AccessRule, ClaimKeyType, RateLimitOption } from "../types/handlers";
import type { HookPhase } from "../types/hooks";
import type { HttpRouteMethod } from "../types/http-route";
import type { NavDefinition } from "../types/nav";
import type { MspErrorMode } from "../types/projection";
import type { RelationDefinition } from "../types/relations";
import type { ScreenDefinition } from "../types/screen";
import type { WorkspaceDefinition } from "../types/workspace";
import {
  addPattern,
  applyChanges,
  type PatternChange,
  type PatternId,
  removePattern,
  replacePattern,
} from "./patch";
import type { FeaturePattern, OpaquePropMap } from "./patterns";
import type { SourceLocation } from "./source-location";

// =============================================================================
// Synthetic SourceLocation — for new patterns that don't have a real file
// span yet. The renderer only reads `.raw` from body locations (handler/
// schema/etc.), so for static patterns the synthetic value is a placeholder
// that never reaches the output.
// =============================================================================

const SYNTHETIC_LOC: SourceLocation = {
  file: "<patcher>",
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
  raw: "",
};

function rawLoc(raw: string): SourceLocation {
  return { ...SYNTHETIC_LOC, raw };
}

// =============================================================================
// Argument shapes — typed inputs per pattern kind. These mirror the
// runtime-API argument signatures so the patcher feels like a slightly
// flatter version of the registrar itself.
// =============================================================================

export type AddEntityArgs = {
  readonly name: string;
  readonly definition: EntityDefinition;
};

export type AddRelationArgs = {
  readonly entity: string;
  readonly name: string;
  readonly definition: RelationDefinition;
};

export type AddWriteHandlerArgs = {
  readonly name: string;
  /** Source text of the Zod schema, e.g. `"z.object({ title: z.string() })"`. */
  readonly schemaSource: string;
  /** Source text of the handler closure, e.g. `"async (event, ctx) => { ... }"`. */
  readonly handlerSource: string;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly skipTransitionGuard?: boolean;
};

export type AddQueryHandlerArgs = {
  readonly name: string;
  readonly schemaSource: string;
  readonly handlerSource: string;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
};

export type AddHookArgs = {
  readonly type: LifecycleHookType | "validation";
  readonly target: string | readonly string[];
  /** Source text of the closure, e.g. `"async (event, ctx) => { ... }"`. */
  readonly handlerSource: string;
  readonly phase?: HookPhase;
};

export type AddEntityHookArgs = {
  readonly type: "postSave" | "preDelete" | "postDelete";
  readonly entity: string;
  readonly handlerSource: string;
  readonly phase?: HookPhase;
};

export type AddJobArgs = {
  readonly name: string;
  readonly options: Omit<JobDefinition, "name" | "handler">;
  readonly handlerSource: string;
};

export type AddNotificationArgs = {
  readonly name: string;
  readonly trigger: { readonly on: string };
  readonly recipientSource: string;
  readonly dataSource: string;
  readonly templates?: Readonly<Record<string, string>>;
};

export type AddHttpRouteArgs = {
  readonly method: HttpRouteMethod;
  readonly path: string;
  readonly handlerSource: string;
  readonly anonymous?: boolean;
};

export type AddDefineEventArgs = {
  readonly name: string;
  readonly schemaSource: string;
  readonly version?: number;
};

export type AddEventMigrationArgs = {
  readonly event: string;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly transformSource: string;
};

export type AddProjectionArgs = {
  readonly name: string;
  readonly sourceEntity: string | readonly string[];
  /** Map of event-type → closure source for the apply handler. */
  readonly applySources: Readonly<Record<string, string>>;
};

export type AddMultiStreamProjectionArgs = {
  readonly name: string;
  readonly applySources: Readonly<Record<string, string>>;
  readonly errorMode?: MspErrorMode;
  readonly runIn?: RunIn;
  readonly delivery?: "shared" | "per-instance";
};

export type AddReferenceDataArgs = {
  readonly entity: string;
  readonly data: readonly Record<string, unknown>[];
  readonly upsertKey?: string;
};

export type AddMetricArgs = { readonly name: string; readonly options: MetricOptions };
export type AddSecretArgs = { readonly name: string; readonly options: SecretOptions };
export type AddClaimKeyArgs = { readonly name: string; readonly type: ClaimKeyType };
export type AddUseExtensionArgs = {
  readonly extension: string;
  readonly entity: string;
  readonly options?: Readonly<Record<string, unknown>>;
};
export type AddScreenArgs = {
  readonly definition: ScreenDefinition;
  /** Source spans for each closure-typed sub-property; keyed by JSON-path
   *  inside the definition (e.g. `"rowActions.0.visible"`). Each entry's
   *  raw is the closure source the renderer will splice in. */
  readonly opaqueSources?: Readonly<Record<string, string>>;
};

// Object-Form args for the previously-positional methods. Every typed
// `add{Kind}` now takes a single object argument so the AI sees one
// uniform method-call shape.
export type AddRequiresArgs = { readonly features: readonly string[] };
export type AddOptionalRequiresArgs = { readonly features: readonly string[] };
export type AddReadsConfigArgs = { readonly keys: readonly string[] };
export type AddToggleableArgs = { readonly default: boolean };
export type AddNavArgs = { readonly definition: NavDefinition };
export type AddWorkspaceArgs = { readonly definition: WorkspaceDefinition };
export type AddConfigArgs = {
  readonly keys: Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>;
};
export type AddTranslationsArgs = { readonly keys: TranslationKeys };
export type AddAuthClaimsArgs = {
  /** Source text of the claims handler closure. */
  readonly handlerSource: string;
};

// =============================================================================
// FeaturePatcher — the public surface
// =============================================================================

// Every typed `add{Kind}` takes a single object argument — uniform shape
// across the API so AI tool-use learns ONE method-call form. The few
// methods that conceptually take "no args" (addSystemScope) still take
// none, but everything that carries data is object-form.
export type FeaturePatcher = {
  // --- Static patterns (no closures) ---
  readonly addRequires: (args: AddRequiresArgs) => void;
  readonly addOptionalRequires: (args: AddOptionalRequiresArgs) => void;
  readonly addReadsConfig: (args: AddReadsConfigArgs) => void;
  readonly addSystemScope: () => void;
  readonly addToggleable: (args: AddToggleableArgs) => void;
  readonly addEntity: (args: AddEntityArgs) => void;
  readonly addRelation: (args: AddRelationArgs) => void;
  readonly addNav: (args: AddNavArgs) => void;
  readonly addWorkspace: (args: AddWorkspaceArgs) => void;
  readonly addConfig: (args: AddConfigArgs) => void;
  readonly addTranslations: (args: AddTranslationsArgs) => void;
  readonly addMetric: (args: AddMetricArgs) => void;
  readonly addSecret: (args: AddSecretArgs) => void;
  readonly addClaimKey: (args: AddClaimKeyArgs) => void;
  readonly addReferenceData: (args: AddReferenceDataArgs) => void;
  readonly addUseExtension: (args: AddUseExtensionArgs) => void;
  // --- Mixed patterns (with opaque source bodies) ---
  readonly addScreen: (args: AddScreenArgs) => void;
  readonly addWriteHandler: (args: AddWriteHandlerArgs) => void;
  readonly addQueryHandler: (args: AddQueryHandlerArgs) => void;
  readonly addHook: (args: AddHookArgs) => void;
  readonly addEntityHook: (args: AddEntityHookArgs) => void;
  readonly addJob: (args: AddJobArgs) => void;
  readonly addNotification: (args: AddNotificationArgs) => void;
  readonly addAuthClaims: (args: AddAuthClaimsArgs) => void;
  readonly addHttpRoute: (args: AddHttpRouteArgs) => void;
  readonly addProjection: (args: AddProjectionArgs) => void;
  readonly addMultiStreamProjection: (args: AddMultiStreamProjectionArgs) => void;
  readonly addDefineEvent: (args: AddDefineEventArgs) => void;
  readonly addEventMigration: (args: AddEventMigrationArgs) => void;
  // --- Symmetric ops (id-driven) ---
  readonly replace: (id: PatternId, pattern: FeaturePattern) => void;
  readonly remove: (id: PatternId) => void;
  readonly apply: (changes: readonly PatternChange[]) => void;
  /**
   * Escape hatch — directly add a hand-built pattern. The typed `add{Kind}`
   * methods above cover every pattern in the catalogue and should be the
   * default path; this method exists for migration tools, AST-replay
   * scenarios, and the rare case where a future pattern-kind isn't yet
   * exposed via a typed method.
   */
  readonly addPattern: (pattern: FeaturePattern) => void;
};

/**
 * Build a patcher bound to the given source file. All methods mutate the
 * file in place; saving is the caller's responsibility (e.g. via
 * `sourceFile.saveSync()`).
 */
export function createFeaturePatcher(sourceFile: SourceFile): FeaturePatcher {
  function add(pattern: FeaturePattern): void {
    addPattern(sourceFile, pattern);
  }

  return {
    addRequires({ features }) {
      add({
        kind: "requires",
        source: SYNTHETIC_LOC,
        featureNames: features,
      });
    },
    addOptionalRequires({ features }) {
      add({
        kind: "optionalRequires",
        source: SYNTHETIC_LOC,
        featureNames: features,
      });
    },
    addReadsConfig({ keys }) {
      add({
        kind: "readsConfig",
        source: SYNTHETIC_LOC,
        qualifiedKeys: keys,
      });
    },
    addSystemScope() {
      add({ kind: "systemScope", source: SYNTHETIC_LOC });
    },
    addToggleable({ default: defaultOn }) {
      add({ kind: "toggleable", source: SYNTHETIC_LOC, default: defaultOn });
    },
    addEntity({ name, definition }) {
      add({
        kind: "entity",
        source: SYNTHETIC_LOC,
        entityName: name,
        definition,
      });
    },
    addRelation({ entity, name, definition }) {
      add({
        kind: "relation",
        source: SYNTHETIC_LOC,
        entityName: entity,
        relationName: name,
        definition,
      });
    },
    addNav({ definition }) {
      add({ kind: "nav", source: SYNTHETIC_LOC, definition });
    },
    addWorkspace({ definition }) {
      add({ kind: "workspace", source: SYNTHETIC_LOC, definition });
    },
    addConfig({ keys }) {
      add({ kind: "config", source: SYNTHETIC_LOC, keys });
    },
    addTranslations({ keys }) {
      add({ kind: "translations", source: SYNTHETIC_LOC, keys });
    },
    addMetric({ name, options }) {
      add({ kind: "metric", source: SYNTHETIC_LOC, shortName: name, options });
    },
    addSecret({ name, options }) {
      add({ kind: "secret", source: SYNTHETIC_LOC, shortName: name, options });
    },
    addClaimKey({ name, type }) {
      add({ kind: "claimKey", source: SYNTHETIC_LOC, shortName: name, claimType: type });
    },
    addReferenceData({ entity, data, upsertKey }) {
      add({
        kind: "referenceData",
        source: SYNTHETIC_LOC,
        entityName: entity,
        data,
        ...(upsertKey !== undefined && { upsertKey }),
      });
    },
    addUseExtension({ extension, entity, options }) {
      add({
        kind: "useExtension",
        source: SYNTHETIC_LOC,
        extensionName: extension,
        entityName: entity,
        ...(options !== undefined && { options }),
      });
    },

    addScreen({ definition, opaqueSources }) {
      const opaqueProps: OpaquePropMap = opaqueSources
        ? Object.fromEntries(Object.entries(opaqueSources).map(([k, v]) => [k, rawLoc(v)]))
        : {};
      add({ kind: "screen", source: SYNTHETIC_LOC, definition, opaqueProps });
    },

    addWriteHandler({ name, schemaSource, handlerSource, access, rateLimit, skipTransitionGuard }) {
      add({
        kind: "writeHandler",
        source: SYNTHETIC_LOC,
        handlerName: name,
        schemaSource: rawLoc(schemaSource),
        handlerBody: rawLoc(handlerSource),
        ...(access !== undefined && { access }),
        ...(rateLimit !== undefined && { rateLimit }),
        ...(skipTransitionGuard === true && { skipTransitionGuard: true }),
      });
    },

    addQueryHandler({ name, schemaSource, handlerSource, access, rateLimit }) {
      add({
        kind: "queryHandler",
        source: SYNTHETIC_LOC,
        handlerName: name,
        schemaSource: rawLoc(schemaSource),
        handlerBody: rawLoc(handlerSource),
        ...(access !== undefined && { access }),
        ...(rateLimit !== undefined && { rateLimit }),
      });
    },

    addHook({ type, target, handlerSource, phase }) {
      add({
        kind: "hook",
        source: SYNTHETIC_LOC,
        hookType: type,
        target,
        fnBody: rawLoc(handlerSource),
        ...(phase !== undefined && { phase }),
      });
    },

    addEntityHook({ type, entity, handlerSource, phase }) {
      add({
        kind: "entityHook",
        source: SYNTHETIC_LOC,
        hookType: type,
        entityName: entity,
        fnBody: rawLoc(handlerSource),
        ...(phase !== undefined && { phase }),
      });
    },

    addJob({ name, options, handlerSource }) {
      add({
        kind: "job",
        source: SYNTHETIC_LOC,
        jobName: name,
        options,
        handlerBody: rawLoc(handlerSource),
      });
    },

    addNotification({ name, trigger, recipientSource, dataSource, templates }) {
      const templateLocs = templates
        ? Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, rawLoc(v)]))
        : undefined;
      add({
        kind: "notification",
        source: SYNTHETIC_LOC,
        notificationName: name,
        trigger,
        recipientBody: rawLoc(recipientSource),
        dataBody: rawLoc(dataSource),
        ...(templateLocs !== undefined && { templates: templateLocs }),
      });
    },

    addAuthClaims({ handlerSource }) {
      add({
        kind: "authClaims",
        source: SYNTHETIC_LOC,
        fnBody: rawLoc(handlerSource),
      });
    },

    addHttpRoute({ method, path, handlerSource, anonymous }) {
      add({
        kind: "httpRoute",
        source: SYNTHETIC_LOC,
        method,
        path,
        handlerBody: rawLoc(handlerSource),
        ...(anonymous === true && { anonymous: true }),
      });
    },

    addProjection({ name, sourceEntity, applySources }) {
      const applyBodies = Object.fromEntries(
        Object.entries(applySources).map(([k, v]) => [k, rawLoc(v)]),
      );
      add({
        kind: "projection",
        source: SYNTHETIC_LOC,
        name,
        sourceEntity,
        applyBodies,
      });
    },

    addMultiStreamProjection({ name, applySources, errorMode, runIn, delivery }) {
      const applyBodies = Object.fromEntries(
        Object.entries(applySources).map(([k, v]) => [k, rawLoc(v)]),
      );
      add({
        kind: "multiStreamProjection",
        source: SYNTHETIC_LOC,
        name,
        applyBodies,
        ...(errorMode !== undefined && { errorMode }),
        ...(runIn !== undefined && { runIn }),
        ...(delivery !== undefined && { delivery }),
      });
    },

    addDefineEvent({ name, schemaSource, version }) {
      add({
        kind: "defineEvent",
        source: SYNTHETIC_LOC,
        eventName: name,
        schemaSource: rawLoc(schemaSource),
        ...(version !== undefined && { version }),
      });
    },

    addEventMigration({ event, fromVersion, toVersion, transformSource }) {
      add({
        kind: "eventMigration",
        source: SYNTHETIC_LOC,
        eventName: event,
        fromVersion,
        toVersion,
        transformBody: rawLoc(transformSource),
      });
    },

    replace(id, pattern) {
      replacePattern(sourceFile, id, pattern);
    },
    remove(id) {
      removePattern(sourceFile, id);
    },
    apply(changes) {
      applyChanges(sourceFile, changes);
    },
    addPattern: add,
  };
}
