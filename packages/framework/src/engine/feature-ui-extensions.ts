import { escapeHatchGrantsProblem } from "@cosmicdrift/kumiko-types/handlers";
import {
  WEBSOCKET_MAX_CONNECTIONS_PER_USER_LIMIT,
  WEBSOCKET_MAX_PAYLOAD_BYTES,
  WEBSOCKET_ROUTE_PATH_PREFIX,
  type WebSocketRouteDefinition,
} from "@cosmicdrift/kumiko-types/websocket-route";
import type { EntityTableMeta } from "../db/entity-table-meta.js";
import { bindHookEscapeHatchGrant } from "../pipeline/system-identity-switch.js";
import { LifecycleHookTypes } from "./constants.js";
import type { FeatureBuilderState } from "./feature-builder-state.js";
import { resolveName } from "./handler-helpers.js";
import { isKebabSegment, isValidQn, qualifyEntityName, toKebab } from "./qualified-name.js";
import type { HttpRouteDefinition } from "./types/http-route.js";
import type {
  BootCheckFn,
  EntityProjectionExtension,
  EscapeHatchDeclaration,
  ExtensionSelectorPanel,
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
} from "./types/index.js";
import { HookPhases } from "./types/index.js";
import type { ContentCollectionDefinition, NavDefinition } from "./types/nav.js";
import type { ScreenDefinition } from "./types/screen.js";
import type { WorkspaceDefinition } from "./types/workspace.js";

// Builds hooks/extensions/projections/screens/nav/workspace/tables/tree-actions
// registrar methods.

// Id the generated owner dashboard reserves for its selector panel.
const RESERVED_SELECTION_PANEL_ID = "selection";

function assertSelectorPanelIds(
  featureName: string,
  extensionName: string,
  panels: readonly ExtensionSelectorPanel[],
): void {
  const seen = new Set<string>();
  for (const { id } of panels) {
    if (id === "" || id === RESERVED_SELECTION_PANEL_ID || seen.has(id)) {
      throw new Error(
        `[Feature ${featureName}] extensionSelector("${extensionName}") panel id "${id}" must be unique, ` +
          `non-empty and not "${RESERVED_SELECTION_PANEL_ID}" (reserved for the selector panel).`,
      );
    }
    seen.add(id);
  }
}

// The owner dashboard lives in the "config" namespace, so a short screen ref must be
// qualified against the declaring feature here. Untyped authors can pass other kinds.
function qualifySelectorPanel(
  featureName: string,
  panel: ExtensionSelectorPanel,
): ExtensionSelectorPanel {
  if (panel.kind === "custom") return panel;
  if (panel.kind === "screen") {
    if ("label" in panel) {
      throw new Error(
        `[Feature ${featureName}] extensionSelector screen panel "${panel.id}" must not set a label — ` +
          `the settings dashboard has no i18n namespace for it; the embedded screen carries its own title.`,
      );
    }
    if (panel.screen === "" || isValidQn(panel.screen)) return panel;
    return { ...panel, screen: qualifyEntityName(featureName, "screen", panel.screen) };
  }
  throw new Error(
    `[Feature ${featureName}] extensionSelector panel ${JSON.stringify(panel)} has an unsupported kind — ` +
      `only "custom" and "screen" panels are allowed.`,
  );
}

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
    // Explicit `undefined` values (e.g. `icon: cond ? "x" : undefined`) would trip
    // buildAppSchema's JSON-safety check, so strip them for every nav path.
    // @cast-boundary engine-bridge — filtering undefined keeps the NavDefinition shape.
    state.navs[navDefinition.id] = Object.fromEntries(
      Object.entries(navDefinition).filter(([, value]) => value !== undefined),
    ) as NavDefinition;
  }

  return {
    hook(
      type: LifecycleHookType | "validation",
      target: NameOrRef | readonly NameOrRef[] | { readonly allOf: NameOrRef },
      fn: LifecycleHookFn | ValidationHookFn,
      options?: { phase?: HookPhase; escapeHatch?: EscapeHatchDeclaration },
    ): void {
      if (type === "validation") {
        if (options?.escapeHatch !== undefined) {
          throw new Error(
            `[Feature ${name}] r.hook("validation", ...) does not accept { escapeHatch } — ` +
              "validation hooks receive no context to switch identity with.",
          );
        }
      } else if (
        options?.escapeHatch !== undefined &&
        options.escapeHatch.reason.trim().length === 0
      ) {
        throw new Error(
          `[Feature ${name}] r.hook("${type}", ...) declares { escapeHatch: { reason: "" } } — ` +
            "the reason must be a non-empty string explaining why this hook switches identity to SYSTEM.",
        );
      }
      const hookGrantsProblem =
        options?.escapeHatch && escapeHatchGrantsProblem(options.escapeHatch);
      if (hookGrantsProblem) {
        throw new Error(
          `[Feature ${name}] r.hook("${type}", ...) declares an invalid escapeHatch — ${hookGrantsProblem}`,
        );
      }

      // Wrapped once for both branches below; validation hooks stay unwrapped (no context).
      const hookLabel = `${type} hook of feature "${name}"`;
      const wrapped: LifecycleHookFn | ValidationHookFn =
        type === "validation"
          ? fn
          : bindHookEscapeHatchGrant(fn as LifecycleHookFn, hookLabel, options?.escapeHatch); // @cast-boundary engine-bridge

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
          wrapped as LifecycleHookFn, // @cast-boundary engine-bridge
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
          state.validationHooks[n] = wrapped as ValidationHookFn; // @cast-boundary engine-bridge
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
          state.lifecycleHooks[type][n].push({
            fn: wrapped as LifecycleHookFn, // @cast-boundary engine-bridge
            featureName: name,
          });
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
        bucket[n].push({
          fn: wrapped as LifecycleHookFn, // @cast-boundary engine-bridge
          phase,
          featureName: name,
        });
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
        | ({ readonly name: string; readonly entity: NameOrRef } & object),
      entityRef?: NameOrRef,
      options?: object,
    ): void {
      const [extensionName, resolvedEntityRef, resolvedOptions] =
        typeof extensionNameOrDefinition === "string"
          ? [extensionNameOrDefinition, entityRef as NameOrRef, options]
          : (() => {
              const { name, entity, ...rest } = extensionNameOrDefinition;
              return [name, entity, rest] as const;
            })();
      const resolvedEntityName = resolveName(resolvedEntityRef);
      // @cast-boundary engine-bridge — typed per-extension options → erased registration bag
      const optionsBag = resolvedOptions as Record<string, unknown> | undefined;
      // fw#2914 — cross-cutting escapeHatch convention for hook-context db
      // access (mirrors r.hook's validation above). Validated the same way
      // for every extension regardless of its typed hook shape.
      const escapeHatch = optionsBag?.["escapeHatch"];
      if (escapeHatch !== undefined) {
        const reason =
          typeof escapeHatch === "object" && escapeHatch !== null
            ? (escapeHatch as { reason?: unknown }).reason
            : undefined;
        if (typeof reason !== "string" || reason.trim().length === 0) {
          throw new Error(
            `[Feature ${name}] r.useExtension("${extensionName}", "${resolvedEntityName}", ...) declares an invalid { escapeHatch } — ` +
              `must be { reason: "<non-empty string>" } explaining why this usage needs unfiltered db access.`,
          );
        }
        const extGrantsProblem = escapeHatchGrantsProblem(escapeHatch as { grants?: unknown });
        if (extGrantsProblem) {
          throw new Error(
            `[Feature ${name}] r.useExtension("${extensionName}", "${resolvedEntityName}", ...) declares an invalid { escapeHatch } — ${extGrantsProblem}`,
          );
        }
      }
      state.extensionUsages.push({
        extensionName,
        entityName: resolvedEntityName,
        options: optionsBag,
      });
    },
    extensionSelector(
      extensionName: string,
      key: { readonly name: string } | string,
      options?: { readonly panels?: readonly ExtensionSelectorPanel[] },
    ): void {
      if (state.extensionSelectors.some((s) => s.extensionName === extensionName)) {
        throw new Error(
          `[Feature ${name}] extensionSelector("${extensionName}") declared twice — ` +
            `one selector key per extension point.`,
        );
      }
      const qualifiedKey = typeof key === "string" ? key : key.name;
      const panels = options?.panels?.map((panel) => qualifySelectorPanel(name, panel));
      assertSelectorPanelIds(name, extensionName, panels ?? []);
      state.extensionSelectors.push({
        extensionName,
        qualifiedKey,
        ...(panels !== undefined && { panels }),
      });
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
    bootCheck(fn: BootCheckFn): void {
      state.bootChecks.push(fn);
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
    contentCollection(definition: ContentCollectionDefinition): string {
      if (state.contentCollections[definition.id]) {
        throw new Error(
          `[Feature ${name}] Content collection "${definition.id}" already registered. ` +
            `Collection ids must be unique per feature.`,
        );
      }
      // registerNav owns the kebab + collision checks, including collisions
      // with a plain r.nav() of the same id.
      registerNav({
        id: definition.id,
        label: definition.nav.label,
        icon: definition.nav.icon,
        parent: definition.nav.parent,
        order: definition.nav.order,
        // Nav visibility follows the collection's access unless the caller
        // overrode it — a node the handler would refuse has no business in
        // the sidebar.
        access: definition.nav.access ?? definition.access,
        workspaces: definition.nav.workspaces,
        createAction: definition.nav.createAction,
        actions: definition.nav.actions,
        // The tree children come from a runtime provider keyed on this QN —
        // a collection without it would render as an empty leaf.
        provider: true,
      });
      state.contentCollections[definition.id] = definition;
      return `${name}:nav:${definition.id}`;
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
      if (typeof definition.anonymous !== "boolean") {
        throw new Error(
          `[Feature ${name}] httpRoute "${definition.method} ${definition.path}" must declare ` +
            `anonymous: true | false — true mounts it public, false behind the session auth chain.`,
        );
      }
      const routeLimit = definition.rateLimit;
      if (
        routeLimit !== undefined &&
        (!Number.isInteger(routeLimit.limit) ||
          routeLimit.limit < 1 ||
          !Number.isInteger(routeLimit.windowSeconds) ||
          routeLimit.windowSeconds < 1)
      ) {
        throw new Error(
          `[Feature ${name}] httpRoute "${definition.method} ${definition.path}" rateLimit needs ` +
            `positive integer limit and windowSeconds.`,
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
    webSocketRoute(definition: WebSocketRouteDefinition): void {
      if (!definition.path.startsWith(WEBSOCKET_ROUTE_PATH_PREFIX)) {
        throw new Error(
          `[Feature ${name}] webSocketRoute path "${definition.path}" must start with ` +
            `"${WEBSOCKET_ROUTE_PATH_PREFIX}" — only that namespace rides the /api/* auth chain ` +
            "the upgrade relies on.",
        );
      }
      if (definition.path.includes("*")) {
        throw new Error(
          `[Feature ${name}] webSocketRoute path "${definition.path}" must not contain "*" — ` +
            "wildcards would let one route swallow unrelated /api/ws/* paths.",
        );
      }
      const { maxMessageBytes } = definition;
      if (
        maxMessageBytes !== undefined &&
        (!Number.isInteger(maxMessageBytes) ||
          maxMessageBytes < 1 ||
          maxMessageBytes > WEBSOCKET_MAX_PAYLOAD_BYTES)
      ) {
        throw new Error(
          `[Feature ${name}] webSocketRoute "${definition.path}" maxMessageBytes must be an ` +
            `integer between 1 and ${WEBSOCKET_MAX_PAYLOAD_BYTES}, got ${maxMessageBytes}.`,
        );
      }
      const { maxConnectionsPerUser } = definition;
      if (
        maxConnectionsPerUser !== undefined &&
        (!Number.isInteger(maxConnectionsPerUser) ||
          maxConnectionsPerUser < 1 ||
          maxConnectionsPerUser > WEBSOCKET_MAX_CONNECTIONS_PER_USER_LIMIT)
      ) {
        throw new Error(
          `[Feature ${name}] webSocketRoute "${definition.path}" maxConnectionsPerUser must be an ` +
            `integer between 1 and ${WEBSOCKET_MAX_CONNECTIONS_PER_USER_LIMIT}, got ${maxConnectionsPerUser}.`,
        );
      }
      if (state.webSocketRoutes[definition.path]) {
        throw new Error(
          `[Feature ${name}] WebSocket route "${definition.path}" already registered. ` +
            "path must be unique per feature.",
        );
      }
      state.webSocketRoutes[definition.path] = definition;
    },
    storeTable(meta: EntityTableMeta, options: StoreTableOptions): void {
      // Name comes from the meta itself — apps already give the table a
      // name when calling defineUnmanagedTable, no need to repeat it.
      const tableName = meta.tableName;
      if (!isKebabSegment(tableName.replace(/_/g, "-"))) {
        // EntityTableMeta uses snake_case for tableName (matches Postgres
        // convention); we just guard against truly broken input.
        throw new Error(
          `[Feature ${name}] Store-table name "${tableName}" must be a ` +
            `valid identifier (lowercase letters, digits, underscores; start with a letter).`,
        );
      }
      if (state.storeTables[tableName]) {
        throw new Error(
          `[Feature ${name}] r.storeTable("${tableName}") already registered. ` +
            `Store-table names must be unique per feature.`,
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
            `defineUnmanagedTable(), or deriveEntityTableMeta(..., { source: "unmanaged" })) — ` +
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
