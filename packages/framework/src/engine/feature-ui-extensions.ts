import type { EntityTableMeta } from "../db/entity-table-meta";
import { LifecycleHookTypes } from "./constants";
import type { FeatureBuilderState } from "./feature-builder-state";
import { isKebabSegment, toKebab } from "./qualified-name";
import type {
  EntityProjectionExtension,
  HookPhase,
  LifecycleHookFn,
  LifecycleHookType,
  MultiStreamProjectionDefinition,
  NameOrRef,
  PostDeleteHookFn,
  PostQueryHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  ProjectionDefinition,
  RegistrarExtensionDef,
  SearchPayloadContributorFn,
  StoreTableOptions,
  TreeActionDef,
  TreeActionsHandle,
  ValidationHookFn,
} from "./types";
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";
import type { HttpRouteDefinition } from "./types/http-route";
import type { NavDefinition } from "./types/nav";
import type { ScreenDefinition } from "./types/screen";
import type { WorkspaceDefinition } from "./types/workspace";

// Builds hooks/extensions/projections/screens/nav/workspace/tables/tree-actions
// registrar methods.

type EntityWideHookType = "postSave" | "preDelete" | "postDelete" | "postQuery";

function isEntityWideHookType(type: LifecycleHookType | "validation"): type is EntityWideHookType {
  return (
    type === LifecycleHookTypes.postSave ||
    type === LifecycleHookTypes.preDelete ||
    type === LifecycleHookTypes.postDelete ||
    type === LifecycleHookTypes.postQuery
  );
}

// r.hook(type, { allOf: entity }, fn) — "all write/query handlers of this
// entity", replacing the old r.entityHook(type, entity, fn). Hook-fn casts
// below: @cast-boundary engine-bridge — typed Dev-API (LifecycleHookFn) →
// erased Map<entityName, fn>.
function registerEntityWideHook(
  state: FeatureBuilderState,
  featureName: string,
  type: EntityWideHookType,
  entityName: string,
  fn: LifecycleHookFn,
  options?: { phase?: HookPhase },
): void {
  if (type === LifecycleHookTypes.postSave) {
    const phase = options?.phase ?? HookPhases.afterCommit;
    if (!state.entityPostSave[entityName]) state.entityPostSave[entityName] = [];
    state.entityPostSave[entityName].push({
      fn: fn as PostSaveHookFn,
      phase,
      featureName,
    }); // @cast-boundary engine-bridge
  } else if (type === LifecycleHookTypes.preDelete) {
    if (!state.entityPreDelete[entityName]) state.entityPreDelete[entityName] = [];
    state.entityPreDelete[entityName].push({
      fn: fn as PreDeleteHookFn, // @cast-boundary engine-bridge
      phase: HookPhases.inTransaction,
      featureName,
    });
  } else if (type === LifecycleHookTypes.postDelete) {
    const phase = options?.phase ?? HookPhases.afterCommit;
    if (!state.entityPostDelete[entityName]) state.entityPostDelete[entityName] = [];
    state.entityPostDelete[entityName].push({
      fn: fn as PostDeleteHookFn,
      phase,
      featureName,
    }); // @cast-boundary engine-bridge
  } else {
    // postQuery is unphased (no inTransaction/afterCommit semantics — fires
    // synchronously after query-handler-execute, before field-access-filter)
    if (!state.entityPostQuery[entityName]) state.entityPostQuery[entityName] = [];
    state.entityPostQuery[entityName].push({ fn: fn as PostQueryHookFn, featureName }); // @cast-boundary engine-bridge
  }
}

export function buildUiExtensionsMethods<TName extends string>(
  state: FeatureBuilderState,
  name: TName,
) {
  // Shared by r.nav() and r.screen()'s inline nav-sugar path — one place
  // for id-validation + collision checks so future registration-time
  // checks (e.g. parent-format, reserved ids) apply to both call sites
  // instead of only the standalone r.nav() one.
  function registerNav(navDefinition: NavDefinition): void {
    if (!isKebabSegment(navDefinition.id)) {
      throw new Error(
        `[Feature ${name}] Nav id "${navDefinition.id}" must be kebab-case ` +
          `(lowercase letters, digits, dashes; start with a letter). ` +
          `Got "${navDefinition.id}" — try "${toKebab(navDefinition.id).replace(/_/g, "-")}".`,
      );
    }
    if (state.navs[navDefinition.id]) {
      throw new Error(
        `[Feature ${name}] Nav entry "${navDefinition.id}" already registered. ` +
          `Nav ids must be unique per feature — remove the standalone ` +
          `r.nav("${navDefinition.id}", ...) call or the screen's inline nav.`,
      );
    }
    state.navs[navDefinition.id] = navDefinition;
  }

  return {
    hook(
      type: LifecycleHookType | "validation",
      target: NameOrRef | readonly NameOrRef[] | { readonly allOf: NameOrRef },
      fn: LifecycleHookFn | ValidationHookFn,
      options?: { phase?: HookPhase },
    ): void {
      // Entity-wide target ("all write/query handlers of this entity") —
      // replaces the old r.entityHook(type, entity, fn).
      if (
        typeof target === "object" &&
        target !== null &&
        !Array.isArray(target) &&
        "allOf" in target
      ) {
        if (!isEntityWideHookType(type)) {
          throw new Error(
            `[Feature ${name}] r.hook("${type}", { allOf }, ...) only supports ` +
              `postSave/preDelete/postDelete/postQuery, not "${type}".`,
          );
        }
        registerEntityWideHook(
          state,
          name,
          type,
          resolveName(target.allOf),
          fn as LifecycleHookFn,
          options,
        );
        // skip: entity-wide target fully handled above, nothing more to do
        return;
      }

      const targets = Array.isArray(target) ? target : [target];
      const names = targets.map(resolveName);

      // Hook-fn casts unten alle: @cast-boundary engine-bridge
      // — typed Dev-API (LifecycleHookFn|ValidationHookFn) → erased Map<name, fn>.
      if (type === "validation") {
        for (const n of names) {
          state.validationHooks[n] = fn as ValidationHookFn; // @cast-boundary engine-bridge
        }
        // skip: validation hooks have no phase, stored and done
        return;
      }

      if (
        type === LifecycleHookTypes.preSave ||
        type === LifecycleHookTypes.preQuery ||
        type === LifecycleHookTypes.postQuery
      ) {
        if (!state.lifecycleHooks[type]) state.lifecycleHooks[type] = {};
        for (const n of names) {
          if (!state.lifecycleHooks[type][n]) state.lifecycleHooks[type][n] = [];
          state.lifecycleHooks[type][n].push({ fn: fn as LifecycleHookFn, featureName: name }); // @cast-boundary engine-bridge
        }
        // skip: pre/post-hooks without phase semantics, stored and done
        return;
      }

      // Phased storage. preDelete has no phase option (always inTransaction);
      // postSave/postDelete default to afterCommit.
      const phase =
        type === LifecycleHookTypes.preDelete
          ? HookPhases.inTransaction
          : (options?.phase ?? HookPhases.afterCommit);
      const bucket = state.phasedLifecycleHooks[type];
      for (const n of names) {
        if (!bucket[n]) bucket[n] = [];
        bucket[n].push({ fn: fn as LifecycleHookFn, phase, featureName: name }); // @cast-boundary engine-bridge
      }
    },
    searchPayloadExtension(entityRef: NameOrRef, fn: SearchPayloadContributorFn): void {
      const entityName = resolveName(entityRef);
      if (!state.searchPayloadExtensions[entityName])
        state.searchPayloadExtensions[entityName] = [];
      state.searchPayloadExtensions[entityName].push({ fn, featureName: name });
    },
    extendsRegistrar(extensionName: string, def: RegistrarExtensionDef): void {
      state.registrarExtensions[extensionName] = def;
    },
    useExtension(
      extensionNameOrDefinition:
        | string
        | ({ readonly name: string; readonly entity: NameOrRef } & Record<string, unknown>),
      entityRef?: NameOrRef,
      options?: Record<string, unknown>,
    ): void {
      const [extensionName, resolvedEntityRef, resolvedOptions] =
        typeof extensionNameOrDefinition === "string"
          ? [extensionNameOrDefinition, entityRef as NameOrRef, options]
          : (() => {
              const { name, entity, ...rest } = extensionNameOrDefinition;
              return [name, entity, rest] as const;
            })();
      state.extensionUsages.push({
        extensionName,
        entityName: resolveName(resolvedEntityRef),
        options: resolvedOptions,
      });
    },
    extensionSelector(extensionName: string, key: { readonly name: string } | string): void {
      if (state.extensionSelectors.some((s) => s.extensionName === extensionName)) {
        throw new Error(
          `[Feature ${name}] extensionSelector("${extensionName}") declared twice — ` +
            `one selector key per extension point.`,
        );
      }
      const qualifiedKey = typeof key === "string" ? key : key.name;
      state.extensionSelectors.push({ extensionName, qualifiedKey });
    },
    /**
     * Marker-Deklaration: dieses Feature stellt eine Cross-Feature-API
     * unter dem genannten Namen bereit. Die eigentliche Implementation
     * wird separat als Query- oder Write-Handler unter dem QN-Pattern
     * registriert; r.exposesApi ist reine Boot-Check-Surface.
     *
     * Beispiel:
     *   defineFeature("compliance-profiles", (r) => {
     *     r.exposesApi("compliance.forTenant");
     *     r.queryHandler({ name: "compliance:query:for-tenant", ... });
     *   });
     *   defineFeature("user-data-rights", (r) => {
     *     r.requires("compliance-profiles");
     *     r.usesApi("compliance.forTenant");
     *     // ruft im Handler: ctx.callQuery("compliance:query:for-tenant", ...)
     *   });
     */
    exposesApi(apiName: string): void {
      if (state.exposedApis.has(apiName)) {
        throw new Error(
          `[Feature ${name}] r.exposesApi("${apiName}") called twice — API names must be unique within a feature.`,
        );
      }
      state.exposedApis.add(apiName);
    },
    /**
     * Declares that this feature calls a cross-feature API. Boot-Validator
     * checkt dass irgendein anderes Feature `r.exposesApi(name)` macht und
     * dass dieses Feature `r.requires` darauf hat.
     */
    usesApi(apiName: string): void {
      state.usedApis.add(apiName);
    },
    projection(definition: ProjectionDefinition): void {
      // Reject names that would blow up at registry-boot when we qualify them.
      // Catch it at the registration site so the stack trace points at the
      // feature file, not at framework internals.
      if (!isKebabSegment(definition.name)) {
        throw new Error(
          `[Feature ${name}] Projection name "${definition.name}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.name}" — try "${toKebab(definition.name).replace(/_/g, "-")}".`,
        );
      }
      if (state.projections[definition.name]) {
        throw new Error(
          `[Feature ${name}] Projection "${definition.name}" already registered. ` +
            `Projection names must be unique per feature.`,
        );
      }
      state.projections[definition.name] = definition;
    },
    multiStreamProjection(definition: MultiStreamProjectionDefinition): void {
      if (!isKebabSegment(definition.name)) {
        throw new Error(
          `[Feature ${name}] MultiStreamProjection name "${definition.name}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.name}" — try "${toKebab(definition.name).replace(/_/g, "-")}".`,
        );
      }
      if (state.multiStreamProjections[definition.name] || state.projections[definition.name]) {
        throw new Error(
          `[Feature ${name}] Projection name "${definition.name}" already registered. ` +
            `r.projection and r.multiStreamProjection share a namespace — pick a unique short name.`,
        );
      }
      if (Object.keys(definition.apply).length === 0) {
        throw new Error(
          `[Feature ${name}] MultiStreamProjection "${definition.name}" has no apply handlers. ` +
            `Declare at least one event type it reacts to, otherwise the dispatcher has nothing to route.`,
        );
      }
      state.multiStreamProjections[definition.name] = definition;
    },
    extendEntityProjection(entityName: string, extension: EntityProjectionExtension): void {
      if (Object.keys(extension.apply).length === 0) {
        throw new Error(
          `[Feature ${name}] extendEntityProjection("${entityName}") has no apply handlers. ` +
            `Declare at least one event type, otherwise the rebuild replay has nothing to do.`,
        );
      }
      // Entity existence + apply-key collisions are validated at registry
      // build — r.entity may legally be called after this in the same feature.
      const list = state.entityProjectionExtensions[entityName] ?? [];
      list.push(extension);
      state.entityProjectionExtensions[entityName] = list;
    },
    referenceData(
      entityRefOrDefinition:
        | NameOrRef
        | {
            readonly entity: NameOrRef;
            readonly data: readonly Record<string, unknown>[];
            readonly upsertKey?: string;
          },
      data?: readonly Record<string, unknown>[],
      options?: { upsertKey?: string },
    ): void {
      const [entityRef, resolvedData, upsertKey] =
        typeof entityRefOrDefinition === "object" && "entity" in entityRefOrDefinition
          ? [
              entityRefOrDefinition.entity,
              entityRefOrDefinition.data,
              entityRefOrDefinition.upsertKey,
            ]
          : [entityRefOrDefinition, data as readonly Record<string, unknown>[], options?.upsertKey];
      state.referenceData.push({
        entityName: resolveName(entityRef),
        data: resolvedData,
        upsertKey,
      });
    },
    screen(definition: ScreenDefinition): void {
      // Reject kebab-drift at registration-time so the stack trace points at
      // the feature file, not at registry-boot. Same guard pattern as
      // r.projection / r.multiStreamProjection.
      if (!isKebabSegment(definition.id)) {
        throw new Error(
          `[Feature ${name}] Screen id "${definition.id}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.id}" — try "${toKebab(definition.id).replace(/_/g, "-")}".`,
        );
      }
      if (state.screens[definition.id]) {
        throw new Error(
          `[Feature ${name}] Screen "${definition.id}" already registered. ` +
            `Screen ids must be unique per feature.`,
        );
      }
      state.screens[definition.id] = definition;
      if (definition.nav) {
        // Sugar for the common "one nav entry pointing at this screen"
        // case — synthesizes id/screen from the screen's own id. Beyond
        // label/icon/parent/order, declare a standalone r.nav() instead.
        registerNav({
          id: definition.id,
          label: definition.nav.label,
          icon: definition.nav.icon,
          parent: definition.nav.parent,
          order: definition.nav.order,
          screen: `${name}:screen:${definition.id}`,
        });
      }
    },
    nav(definition: NavDefinition): void {
      registerNav(definition);
    },
    workspace(definition: WorkspaceDefinition): void {
      // Same kebab guard as r.screen / r.nav so authoring-time mistakes
      // surface at the feature file, not deep in registry boot.
      if (!isKebabSegment(definition.id)) {
        throw new Error(
          `[Feature ${name}] Workspace id "${definition.id}" must be kebab-case ` +
            `(lowercase letters, digits, dashes; start with a letter). ` +
            `Got "${definition.id}" — try "${toKebab(definition.id).replace(/_/g, "-")}".`,
        );
      }
      if (state.workspaces[definition.id]) {
        throw new Error(
          `[Feature ${name}] Workspace "${definition.id}" already registered. ` +
            `Workspace ids must be unique per feature.`,
        );
      }
      state.workspaces[definition.id] = definition;
    },
    httpRoute(definition: HttpRouteDefinition): void {
      // Path-Validation: muss mit "/" beginnen, keine /api/-Routes (die
      // sind dem Dispatcher reserviert; eine HTTP-Route die /api/foo
      // belegt, würde die Auth-Middleware umgehen ohne dass der Author
      // das ausgesprochen hat — bewusster Block).
      if (!definition.path.startsWith("/")) {
        throw new Error(
          `[Feature ${name}] httpRoute path "${definition.path}" must start with "/". ` +
            `Got "${definition.path}".`,
        );
      }
      if (definition.path === "/api" || definition.path.startsWith("/api/")) {
        throw new Error(
          `[Feature ${name}] httpRoute path "${definition.path}" is in the /api/* namespace ` +
            `which is reserved for the dispatcher (write/query/batch/auth/sse). ` +
            `Pick a different path or use r.queryHandler / r.writeHandler.`,
        );
      }
      const key = `${definition.method} ${definition.path}`;
      if (state.httpRoutes[key]) {
        throw new Error(
          `[Feature ${name}] HTTP-Route "${key}" already registered. ` +
            `method + path must be unique per feature.`,
        );
      }
      state.httpRoutes[key] = definition;
    },
    storeTable(meta: EntityTableMeta, options: StoreTableOptions): void {
      // Name comes from the meta itself — apps already give the table a
      // name when calling defineUnmanagedTable, no need to repeat it.
      const tableName = meta.tableName;
      if (!isKebabSegment(tableName.replace(/_/g, "-"))) {
        // EntityTableMeta uses snake_case for tableName (matches Postgres
        // convention); we just guard against truly broken input.
        throw new Error(
          `[Feature ${name}] Raw-table name "${tableName}" must be a ` +
            `valid identifier (lowercase letters, digits, underscores; start with a letter).`,
        );
      }
      if (state.storeTables[tableName]) {
        throw new Error(
          `[Feature ${name}] r.storeTable("${tableName}") already registered. ` +
            `Raw-table names must be unique per feature.`,
        );
      }
      // `read_` is reserved for r.entity()/r.projection() (managed,
      // event-sourced, rebuildable). storeTable is the unmanaged
      // direct-write escape hatch — the prefix must say so (#1220).
      if (tableName.startsWith("read_")) {
        throw new Error(
          `[Feature ${name}] r.storeTable("${tableName}"): the "read_" prefix is reserved ` +
            `for managed r.entity()/r.projection() tables. Pick an unprefixed name or a ` +
            `distinct prefix (e.g. "store_${tableName.slice("read_".length)}").`,
        );
      }
      // meta.source must agree with the r.storeTable() escape hatch, or the
      // migrate-generator treats schema drift on this table as safe to
      // DROP+rebuild-from-events — wiping direct-write data with no events
      // to replay it from (#1209).
      if (meta.source !== "unmanaged") {
        throw new Error(
          `[Feature ${name}] r.storeTable("${tableName}") was given an EntityTableMeta with ` +
            `source: "${meta.source}". r.storeTable() requires source: "unmanaged" (via ` +
            `defineUnmanagedTable(), or buildEntityTableMeta(..., { source: "unmanaged" })) — ` +
            `otherwise the migration generator will treat schema drift on this table as safe ` +
            `to DROP+rebuild, wiping any direct-write data.`,
        );
      }
      // The `reason` is the marker that justifies the bypass — empty
      // strings would defeat the audit trail. Reject early so the
      // failure points at the feature file.
      if (typeof options.reason !== "string" || options.reason.trim().length === 0) {
        throw new Error(
          `[Feature ${name}] r.storeTable("${tableName}"): options.reason must be a ` +
            `non-empty string. The reason justifies the audit-trail bypass — ` +
            `if you can't write one, declare data via r.entity() instead.`,
        );
      }
      state.storeTables[tableName] = {
        name: tableName,
        meta,
        reason: options.reason,
        ...(options.piiEncryptedOnWrite && { piiEncryptedOnWrite: true }),
      };
    },
    treeActions<const TActions extends Record<string, TreeActionDef>>(
      actions: TActions,
    ): TreeActionsHandle<TName, TActions> {
      // Only-once-guard: zweiter Aufruf ist Author-Bug, soll am
      // Feature-File aufschlagen (gleicher Stil wie r.toggleable).
      if (state.treeActions !== undefined) {
        throw new Error(
          `[Feature ${name}] r.treeActions() already called. ` +
            `Each feature may declare a single tree-actions schema.`,
        );
      }
      state.treeActions = actions;
      // Return typed handle für setup-export. Frozen damit Caller die
      // Map nicht nachträglich mutieren (würde Pattern-AST + Runtime-
      // Lookup divergieren lassen).
      return Object.freeze({
        id: name,
        treeActions: actions,
      });
    },
  };
}
