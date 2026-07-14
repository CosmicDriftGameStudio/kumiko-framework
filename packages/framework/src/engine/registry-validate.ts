import { configureEventPiiCatalog } from "../crypto/event-pii";
import type { RegistryState } from "./registry-state";
import { buildImplicitProjection, hasFieldAccessRules, qualify } from "./registry-state";
import {
  buildSoftDeleteCleanupJob,
  buildSoftDeleteCleanupSystemJob,
  SOFT_DELETE_CLEANUP_JOB,
  SOFT_DELETE_CLEANUP_SYSTEM_JOB,
  SOFT_DELETE_GRACE_DAYS_KEY,
  softDeleteGraceDaysConfig,
} from "./soft-delete-cleanup";
import type { EventPiiFields, EventUpcastFn, FeatureDefinition } from "./types";
import { HookPhases } from "./types";
import { resolveName } from "./types/handlers";

// Pass 2 for workspaces: fold any nav-self-assigned QNs into their
// workspace's member list. Safe now that every feature (and therefore every
// workspace) is in state.workspaceMap.
export function finalizeWorkspaceNavMembership(state: RegistryState): void {
  // workspace's member list. We can do this safely now that every feature
  // (and therefore every workspace) is in state.workspaceMap. Cross-feature refs
  // — a nav from feature A self-assigning to a workspace from feature B —
  // resolve here because B's workspace was registered in pass 1 above.
  // Dedup: a nav entry that's also in r.workspace({ nav: [...] }) shouldn't
  // appear twice. Boot-validator catches dangling workspace ids.
  for (const [navQn, navDef] of state.navMap) {
    if (!navDef.workspaces || navDef.workspaces.length === 0) continue;
    for (const wsQn of navDef.workspaces) {
      const members = state.navsByWorkspace.get(wsQn);
      if (members === undefined) continue; // dangling — boot-validator reports
      if (!members.includes(navQn)) members.push(navQn);
    }
  }
}

// Build handler → entity mapping from feature declarations. Must happen before
// extension processing since extension preSave hooks need entity mappings.
export function populateHandlerEntityMappings(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Build handler → entity mapping from feature declarations (filled by tryMapEntity
  // in defineFeature via the "entityName:verb" colon convention).
  // Must happen before extension processing since extension preSave hooks need entity mappings.
  for (const feature of features) {
    for (const [handlerName, entityName] of Object.entries(feature.handlerEntityMappings ?? {})) {
      const writeQn = qualify(feature.name, "write", handlerName);
      const queryQn = qualify(feature.name, "query", handlerName);
      if (state.writeHandlerMap.has(writeQn)) {
        state.handlerEntityMap.set(writeQn, entityName);
      }
      if (state.queryHandlerMap.has(queryQn)) {
        state.handlerEntityMap.set(queryQn, entityName);
      }
    }
  }
}

export function validateExtensionSelectors(state: RegistryState): void {
  // Selector declarations point into the merged extension + config-key
  // sets — a typo'd extension or dropped key must fail the boot, not
  // silently un-gate readiness.
  for (const [extensionName, qualifiedKey] of state.extensionSelectorMap) {
    if (!state.extensionMap.has(extensionName)) {
      throw new Error(
        `extensionSelector("${extensionName}") declared but no feature ` +
          `registers that extension via extendsRegistrar.`,
      );
    }
    if (!state.configKeyMap.has(qualifiedKey)) {
      throw new Error(
        `extensionSelector("${extensionName}") points at unknown config key ` +
          `"${qualifiedKey}" — no mounted feature declares it.`,
      );
    }
  }
}

// Process extension usages: call onRegister, apply extendSchema, register hooks.
export function applyExtensionUsages(state: RegistryState): void {
  // Process extension usages: call onRegister, apply extendSchema, register hooks
  for (const usage of state.extensionUsages) {
    const ext = state.extensionMap.get(usage.extensionName);
    if (!ext) continue;

    if (ext.onRegister) {
      ext.onRegister(usage.entityName, usage.options);
    }

    // extendSchema: merge extra fields into entity definition
    if (ext.extendSchema) {
      const entity = state.entityMap.get(usage.entityName);
      if (entity) {
        const extraFields = ext.extendSchema(usage.entityName);
        const merged = { ...entity, fields: { ...entity.fields, ...extraFields } };
        state.entityMap.set(usage.entityName, merged);
      }
    }

    // Extension hooks → entity hooks (fire for all writes on the entity).
    // Extensions default to afterCommit phase (same default as r.hook).
    //
    // Owner "*" = always-enabled, not gated by feature-toggles. Extensions
    // are plumbing (e.g. ownership) — the feature that declared them might
    // itself be toggleable, but the extension-hook is conceptually part of
    // the entity's invariants. If future requirements need extension hooks
    // to also be gated, store the registering-feature on
    // RegistrarExtensionRegistration and use that here.
    const extOwner = "*";
    if (ext.hooks) {
      if (ext.hooks.postSave) {
        const existing = state.entityPostSaveHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postSave,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPostSaveHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.preDelete) {
        const existing = state.entityPreDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.preDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPreDeleteHooks.set(usage.entityName, existing);
      }
      if (ext.hooks.postDelete) {
        const existing = state.entityPostDeleteHooks.get(usage.entityName) ?? [];
        existing.push({
          fn: ext.hooks.postDelete,
          phase: HookPhases.afterCommit,
          featureName: extOwner,
        });
        state.entityPostDeleteHooks.set(usage.entityName, existing);
      }
      // preSave on extensions: store as handler hook for all CRUD handlers of this entity
      if (ext.hooks.preSave) {
        // Find all write handlers that belong to this entity via state.handlerEntityMap
        for (const qualifiedHandler of state.writeHandlerMap.keys()) {
          if (state.handlerEntityMap.get(qualifiedHandler) === usage.entityName) {
            const existing = state.preSaveHooks.get(qualifiedHandler) ?? [];
            existing.push({ fn: ext.hooks.preSave, featureName: extOwner });
            state.preSaveHooks.set(qualifiedHandler, existing);
          }
        }
      }
    }
  }
}

// Precompute: searchable/sortable fields.
export function buildSearchableSortableCaches(state: RegistryState): void {
  // Precompute: searchable/sortable fields, search includes, incoming relations

  for (const [name, entity] of state.entityMap) {
    const searchable: string[] = [];
    const sortable: string[] = [];
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (field.type === "text" && field.searchable === true) searchable.push(fieldName);
      if (field.type === "text" && field.sortable === true) sortable.push(fieldName);
      if (field.type === "embedded") {
        for (const [subName, subField] of Object.entries(field.schema)) {
          if (subField.searchable === true) searchable.push(`${fieldName}_${subName}`);
        }
      }
    }
    state.searchableFieldsCache.set(name, searchable);
    state.sortableFieldsCache.set(name, sortable);
  }
}

// Implicit-Projection pro r.entity — see buildImplicitProjection doc above.
export function buildImplicitProjections(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Implicit-Projection pro r.entity. Macht die Entity-Tabelle rebaubar
  // ohne dass Apps eine explizite r.projection schreiben müssen.
  // Naming-Convention: `<feature>:projection:<entityName>-entity` — der
  // "-entity"-Suffix unterscheidet implicit von explicit-Projections und
  // vermeidet Kollisionen wenn jemand z.B. eine Cross-Aggregate-Projection
  // mit Entity-Name registriert.
  for (const feature of features) {
    // extendEntityProjection targets must exist as r.entity in the SAME
    // feature — a typo'd entity name would otherwise vanish silently and the
    // extension's events would still be wiped on rebuild.
    for (const extEntity of Object.keys(feature.entityProjectionExtensions ?? {})) {
      if (!feature.entities?.[extEntity]) {
        throw new Error(
          `[Feature ${feature.name}] extendEntityProjection("${extEntity}"): no r.entity ` +
            `with that name in this feature. Declare the entity first — the extension ` +
            `merges into its implicit projection.`,
        );
      }
    }
    for (const [entityName, entity] of Object.entries(feature.entities ?? {})) {
      const def = buildImplicitProjection(
        feature.name,
        entityName,
        entity,
        qualify,
        feature.entityTables?.[entityName],
        feature.entityProjectionExtensions?.[entityName] ?? [],
      );
      if (state.projectionMap.has(def.name)) {
        throw new Error(
          `Implicit projection "${def.name}" kollidiert mit einer explizit registrierten r.projection. ` +
            `Implicit-Projections werden für jede r.entity mit "-entity"-Suffix angelegt — ` +
            `benenne deine explicit projection um (z.B. "<entity>-summary") um die Kollision aufzulösen.`,
        );
      }
      state.projectionMap.set(def.name, def);
      const existing = state.projectionsBySource.get(entityName) ?? [];
      existing.push(def);
      state.projectionsBySource.set(entityName, existing);
    }
  }
}

export function validateNoRawTableProjectionClash(state: RegistryState): void {
  // Cross-cut: a r.rawTable() PgTable must not coincide with any
  // registered projection's table. Silent dedupe via Set would mask a
  // real authoring bug (two owners writing to the same physical table).
  // Run after both passes so implicit projections are visible too.
  const projectionTables = new Set<unknown>();
  for (const proj of state.projectionMap.values()) projectionTables.add(proj.table);
  for (const msp of state.multiStreamProjectionMap.values()) {
    if (msp.table) projectionTables.add(msp.table);
  }
  for (const raw of state.rawTableMap.values()) {
    if (projectionTables.has(raw.table)) {
      throw new Error(
        `r.rawTable "${raw.name}" (feature "${raw.featureName}") shares a Drizzle ` +
          `PgTable with a registered projection. Pick one owner: r.entity() / ` +
          `r.projection() for event-sourced reads, r.rawTable() for the bypass.`,
      );
    }
  }
}

export function buildSearchIncludesAndIncomingRelations(state: RegistryState): void {
  for (const [entityName, rels] of state.relationMap) {
    const includes = new Map<string, readonly string[]>();
    for (const [relName, rel] of Object.entries(rels)) {
      if ((rel.type === "belongsTo" || rel.type === "manyToMany") && rel.searchInclude?.length) {
        includes.set(relName, rel.searchInclude);
      }
    }
    state.searchIncludesCache.set(entityName, includes);

    // Build reverse index for incoming relations
    for (const [relName, rel] of Object.entries(rels)) {
      const existing = state.incomingRelationsCache.get(rel.target) ?? [];
      existing.push({ sourceEntity: entityName, relationName: relName, relation: rel });
      state.incomingRelationsCache.set(rel.target, existing);
    }
  }
}

export function validateFieldAccessHandlersAreEntityMapped(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Validate: handlers in features with field-access rules must be entity-mapped.
  // Without entity mapping, field-level access checks are silently skipped (security gap).
  for (const feature of features) {
    if (!hasFieldAccessRules(feature)) continue;

    for (const handlerName of Object.keys(feature.writeHandlers ?? {})) {
      const qualified = qualify(feature.name, "write", handlerName);
      if (!state.handlerEntityMap.has(qualified)) {
        throw new Error(
          `Write handler "${qualified}" is not mapped to any entity, but feature "${feature.name}" has field-level access rules. ` +
            `Name must follow "entity:verb" convention (e.g. "user:create") or use create/update/delete on a matching entity.`,
        );
      }
    }

    // Query handlers: only those with a colon must resolve (typo protection).
    for (const handlerName of Object.keys(feature.queryHandlers ?? {})) {
      if (!handlerName.includes(":")) continue;
      const qualified = qualify(feature.name, "query", handlerName);
      if (!state.handlerEntityMap.has(qualified)) {
        throw new Error(
          `Query handler "${qualified}" looks entity-bound but no matching entity exists. ` +
            `Either fix the entity name, or use a name without colons for standalone queries.`,
        );
      }
    }
  }
}

export function validateRelationTargetsExist(state: RegistryState): void {
  // Validate: all relation targets must reference existing entities
  for (const [entityName, rels] of state.relationMap) {
    for (const [relName, rel] of Object.entries(rels)) {
      if (!state.entityMap.has(rel.target)) {
        throw new Error(
          `Relation "${entityName}.${relName}" targets entity "${rel.target}" which does not exist`,
        );
      }
    }
  }
}

export function validateEventMigrationVersions(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Build + validate event upcaster chains. Run AFTER all features are
  // ingested so r.eventMigration calls can reference events from any
  // feature (same feature in practice, but the check stays lax for future
  // cross-feature event packs).
  for (const feature of features) {
    for (const [shortName, migrations] of Object.entries(feature.eventMigrations ?? {})) {
      const qualified = qualify(feature.name, "event", shortName);
      const eventDef = state.eventMap.get(qualified);
      if (!eventDef) {
        throw new Error(
          `Feature "${feature.name}" registered r.eventMigration for "${shortName}" ` +
            `but no r.defineEvent exists for that name. Register the event first.`,
        );
      }
      for (const m of migrations) {
        if (m.toVersion > eventDef.version) {
          throw new Error(
            `Feature "${feature.name}" has r.eventMigration("${shortName}", ${m.fromVersion}, ${m.toVersion}) ` +
              `but r.defineEvent declares only version ${eventDef.version}. ` +
              `Bump the version in defineEvent to at least ${m.toVersion}, or remove the migration.`,
          );
        }
      }
    }
  }
}

export function buildEventUpcasterChains(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Stitch the upcaster chain per qualified event. At this point, gaps in
  // the chain (e.g. defineEvent version=3 but only a 1→2 migration exists)
  // are hard errors — they would silently hand a v2-shape payload to a
  // consumer expecting v3 at runtime, which is the class of bug upcasters
  // are supposed to prevent.
  for (const [qualified, eventDef] of state.eventMap) {
    const chainMap = new Map<number, EventUpcastFn>();
    // Locate the feature that owns this event (to pick up its migrations).
    for (const feature of features) {
      for (const [shortName, migs] of Object.entries(feature.eventMigrations ?? {})) {
        const candidateQn = qualify(feature.name, "event", shortName);
        if (candidateQn !== qualified) continue;
        for (const m of migs) chainMap.set(m.fromVersion, m.transform);
      }
    }
    if (eventDef.version > 1) {
      for (let v = 1; v < eventDef.version; v++) {
        if (!chainMap.has(v)) {
          throw new Error(
            `Event "${qualified}" declares version ${eventDef.version} but no migration ` +
              `covers the step v${v} → v${v + 1}. Register r.eventMigration("${qualified.split(":").pop() ?? qualified}", ${v}, ${v + 1}, transform) ` +
              `so stored v${v} payloads can be upcast on read.`,
          );
        }
      }
    }
    state.eventUpcasterMap.set(qualified, {
      currentVersion: eventDef.version,
      chain: chainMap,
    });
  }
}

export function validateProjectionApplyKeys(state: RegistryState): void {
  // Validate: every projection's source must reference a registered entity.
  // A typo ("unti" instead of "unit") would otherwise be a silent no-op —
  // the projection is stored but never fires because no aggregateType ever
  // matches. Fail at boot so the feature author sees it immediately.
  //
  // Same guard extends to apply-keys: a handler for "unit.creatd" (missing
  // 'e') would silently never fire. Valid apply-keys are the auto-generated
  // CRUD types per source entity PLUS every domain event registered via
  // r.defineEvent — an apply-handler for a domain event is how a projection
  // reacts to ctx.appendEvent writes on the same aggregate stream.
  const AUTO_EVENT_VERBS = ["created", "updated", "deleted", "restored", "forgotten"] as const;
  const allDomainEventNames = new Set(state.eventMap.keys());
  for (const [projName, projDef] of state.projectionMap) {
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
    // extraSources (r.extendEntityProjection) sit in the rebuild filter, so
    // their auto-verbs are legitimately observable apply-keys too.
    const rebuildSources = [...sources, ...(projDef.extraSources ?? [])];
    const validEventTypes = new Set<string>();
    // Two source-modes are legal:
    //
    //  (a) Registered entity (r.entity(src, ...)) — the "normal" case:
    //      auto-lifecycle events `<src>.created/.updated/.deleted/.restored`
    //      fire when the event-store-executor writes, and any domain-event
    //      (r.defineEvent) appended onto an aggregate of that type is
    //      observable too.
    //
    //  (b) Events-only source — no r.entity registered, but at least one
    //      apply-key must be a domain-event (not a CRUD-verb on the source
    //      name). Use-case: features that own an append-only event-stream
    //      without a CRUD lifecycle, e.g. `deliveryAttempt` (each call to
    //      the delivery-service produces one event on a fresh aggregate)
    //      or `jobRun` (BullMQ-callback-driven lifecycle, no executor).
    //      A "Shape-Anchor"-entity is no longer needed for this case.
    const isEventsOnlySource = !sources.every((src) => state.entityMap.has(src));
    for (const src of rebuildSources) {
      if (state.entityMap.has(src)) {
        for (const verb of AUTO_EVENT_VERBS) validEventTypes.add(`${src}.${verb}`);
      }
    }
    // Domain events are valid apply-keys for any projection. They arrive via
    // ctx.appendEvent on a specific aggregate — the runtime matches by event
    // type, so a projection can observe domain events whose aggregate matches
    // one of its declared sources.
    for (const domainEvt of allDomainEventNames) validEventTypes.add(domainEvt);

    // In events-only mode, at least one apply-key MUST be a domain-event —
    // otherwise the source is simply a typo (no events will ever fire).
    if (isEventsOnlySource) {
      const hasAnyDomainEvent = Object.keys(projDef.apply).some((k) => allDomainEventNames.has(k));
      if (!hasAnyDomainEvent) {
        const unregistered = sources.filter((src) => !state.entityMap.has(src));
        throw new Error(
          `Projection "${projName}" declares source(s) [${unregistered.join(", ")}] that are not registered entities, ` +
            `and has no domain-event apply-keys. This is either a typo or a missing r.defineEvent registration. ` +
            `Events-only projections need at least one apply-key from r.defineEvent; ` +
            `CRUD-style projections need r.entity("${unregistered[0]}", ...).`,
        );
      }
    }

    for (const applyKey of Object.keys(projDef.apply)) {
      if (!validEventTypes.has(applyKey)) {
        throw new Error(
          `Projection "${projName}" has an apply handler for "${applyKey}" but no such event ` +
            `type exists for its source(s) [${sources.join(", ")}]. ` +
            `Valid types: ${[...validEventTypes].join(", ")}. ` +
            `Check for a typo — auto-verbs follow "<entity>.<verb>"; ` +
            `domain events follow "<feature>:event:<short-name>" (see r.defineEvent).`,
        );
      }
    }
  }
}

export function validateRequiredFeatures(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Validate: all required features must be registered
  for (const feature of features) {
    for (const required of feature.requires ?? []) {
      if (!state.featureMap.has(required)) {
        throw new Error(
          `Feature "${feature.name}" requires feature "${required}" which is not registered`,
        );
      }
    }
  }
}

export function resolveNotificationTriggersAndRegisterHooks(state: RegistryState): void {
  // Resolve notification triggers and register postSave hooks
  // Done after all features are registered so cross-feature triggers work
  const allHandlerNames = new Set([
    ...state.writeHandlerMap.keys(),
    ...state.queryHandlerMap.keys(),
  ]);
  for (const [qualifiedName, notifDef] of state.notificationMap) {
    // Both maps are populated in lockstep — same key-set by construction.
    const featureName = state.notificationFeatureMap.get(qualifiedName) as string; // @cast-boundary engine-bridge
    // I'll try the easy path first: if the trigger is already a fully qualified QN
    // (cross-feature), I take it as-is. Otherwise I qualify with the own feature —
    // as a write handler first (the common case), then as a query. If nothing
    // matches by then, it was a typo and I'll say so.
    let triggerOn: string;
    if (allHandlerNames.has(notifDef.trigger.on)) {
      triggerOn = notifDef.trigger.on;
    } else {
      // Try as write handler first (most common), then query
      const writeQn = qualify(featureName, "write", notifDef.trigger.on);
      const queryQn = qualify(featureName, "query", notifDef.trigger.on);
      if (allHandlerNames.has(writeQn)) {
        triggerOn = writeQn;
      } else if (allHandlerNames.has(queryQn)) {
        triggerOn = queryQn;
      } else {
        throw new Error(
          `Notification "${qualifiedName}" triggers on "${notifDef.trigger.on}" ` +
            `but no handler with that name exists. ` +
            `Tried: "${notifDef.trigger.on}", "${writeQn}", and "${queryQn}"`,
        );
      }
    }
    // Update the stored definition with resolved trigger
    state.notificationMap.set(qualifiedName, { ...notifDef, trigger: { on: triggerOn } });

    if (!state.postSaveHooks.has(triggerOn)) state.postSaveHooks.set(triggerOn, []);
    state.postSaveHooks.get(triggerOn)?.push({
      phase: HookPhases.afterCommit,
      featureName,
      fn: async (result, context) => {
        if (!context.notify) {
          context.log?.debug(
            `notification ${qualifiedName}: skipping — no notify function configured on context`,
          );
          return;
        }
        const to = notifDef.recipient(result);
        if (to === null) {
          context.log?.debug(
            `notification ${qualifiedName}: skipping — recipient resolver returned null for result ${result.id}`,
          );
          return;
        }
        const data = notifDef.data(result);
        await context.notify(qualifiedName, { to, data });
      },
    });
  }
}

export function validateLifecycleHookTargets(state: RegistryState): void {
  // Validate: lifecycle hook targets must reference existing handlers
  const allHandlers = new Set([...state.writeHandlerMap.keys(), ...state.queryHandlerMap.keys()]);
  const lifecycleHookMaps = [
    { map: state.preSaveHooks, phase: "preSave" },
    { map: state.postSaveHooks, phase: "postSave" },
    { map: state.preDeleteHooks, phase: "preDelete" },
    { map: state.postDeleteHooks, phase: "postDelete" },
    { map: state.preQueryHooks, phase: "preQuery" },
    { map: state.postQueryHooks, phase: "postQuery" },
  ] as const;

  // I'd rather warn you now at boot than have you open a ticket three weeks from now
  // saying "my hook isn't firing". One typo in the target and the thing goes silent.
  for (const { map, phase } of lifecycleHookMaps) {
    for (const hookTarget of map.keys()) {
      if (!allHandlers.has(hookTarget)) {
        throw new Error(
          `${phase} hook targets "${hookTarget}" but no handler with that name exists. ` +
            `Check for typos — the hook will never fire.`,
        );
      }
    }
  }
}

export function validateEntityHookTargets(
  state: RegistryState,
  features: readonly FeatureDefinition[],
): void {
  // Same logic for entity-keyed hooks — targets must reference existing entities.
  // Memory `feedback_dead_hook_needs_second_consumer`: a typo silently registers
  // and never fires. Validates all four entity-hook types (postSave/preDelete/
  // postDelete/postQuery) — net cleanup of an existing antipattern, not a
  // postQuery-special.
  const allEntities = new Set<string>();
  for (const feature of features) {
    for (const entityName of Object.keys(feature.entities ?? {})) {
      allEntities.add(entityName);
    }
  }
  const entityHookMaps = [
    { map: state.entityPostSaveHooks, phase: "postSave (entityHook)", kind: "hook" },
    { map: state.entityPreDeleteHooks, phase: "preDelete (entityHook)", kind: "hook" },
    { map: state.entityPostDeleteHooks, phase: "postDelete (entityHook)", kind: "hook" },
    { map: state.entityPostQueryHooks, phase: "postQuery (entityHook)", kind: "hook" },
    { map: state.searchPayloadExtensions, phase: "searchPayloadExtension", kind: "extension" },
  ] as const;
  for (const { map, phase, kind } of entityHookMaps) {
    for (const entityName of map.keys()) {
      if (!allEntities.has(entityName)) {
        throw new Error(
          `${phase} ${kind} targets entity "${entityName}" but no entity with that name exists. ` +
            `Check for typos — the ${kind} will never fire.`,
        );
      }
    }
  }
}

export function validateJobTriggers(state: RegistryState): void {
  // Validate: job event triggers must reference existing handlers.
  // Multi-Trigger-Form: jeden Eintrag im Array gegen allHandlers prüfen,
  // auch wenn nur einer fehlt fail-fast.
  const allHandlers = new Set([...state.writeHandlerMap.keys(), ...state.queryHandlerMap.keys()]);
  for (const [jobName, jobDef] of state.jobMap) {
    if (!("on" in jobDef.trigger)) continue;
    const triggerOn = jobDef.trigger.on;
    const triggers = Array.isArray(triggerOn) ? triggerOn : [triggerOn];
    for (const t of triggers) {
      const rawName = resolveName(t);
      if (allHandlers.has(rawName)) continue;
      throw new Error(
        `Job "${jobName}" triggers on "${rawName}" but no handler with that name exists`,
      );
    }
  }
}

export function validateExtensionUsageTargets(state: RegistryState): void {
  // Validate: extension usages must reference existing extensions
  for (const usage of state.extensionUsages) {
    if (!state.extensionMap.has(usage.extensionName)) {
      throw new Error(
        `Extension usage "${usage.extensionName}" on entity "${usage.entityName}" references an extension that does not exist`,
      );
    }
  }
}

// Pre-compute: any handler with a rateLimit option?
export function computeHasRateLimitedHandler(state: RegistryState): void {
  // Pre-compute: any handler with a rateLimit option? Keeps the boot
  // path able to short-circuit the RateLimitResolver wiring (and its
  // Lua-script registration on Redis) when nobody opted in.
  state.hasRateLimitedHandlerCached = (() => {
    for (const h of state.writeHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    for (const h of state.queryHandlerMap.values()) if (h.rateLimit !== undefined) return true;
    return false;
  })();
}

export function publishEventPiiCatalog(state: RegistryState): void {
  // Publish the event-PII catalog (#799): append() — the single write funnel
  // into kumiko_events — encrypts catalogued payload fields regardless of
  // which path produced the event (ctx.appendEvent, MSP-apply, low-level
  // append in delivery/jobs loggers).
  const eventPiiCatalog = new Map<string, EventPiiFields>();
  for (const [qualified, def] of state.eventMap) {
    if (def.piiFields) eventPiiCatalog.set(qualified, def.piiFields);
  }
  configureEventPiiCatalog(eventPiiCatalog);
}

export function autoWireSoftDeleteJobs(state: RegistryState): void {
  // Auto-wire the soft-delete cleanup cron + its grace-days config key when ANY
  // entity opts into softDelete — the framework owns this machinery, no feature
  // declares it (mirrors the auto restore-handler). Job-runner reads getAllJobs
  // ungated; config-resolver reads getConfigKey → default. Reserved owner
  // segment, guarded against a real-feature collision.
  if ([...state.entityMap.values()].some((e) => e.softDelete)) {
    if (!state.jobMap.has(SOFT_DELETE_CLEANUP_JOB)) {
      state.jobMap.set(SOFT_DELETE_CLEANUP_JOB, buildSoftDeleteCleanupJob());
    }
    if (!state.jobMap.has(SOFT_DELETE_CLEANUP_SYSTEM_JOB)) {
      state.jobMap.set(SOFT_DELETE_CLEANUP_SYSTEM_JOB, buildSoftDeleteCleanupSystemJob());
    }
    if (!state.configKeyMap.has(SOFT_DELETE_GRACE_DAYS_KEY)) {
      state.configKeyMap.set(SOFT_DELETE_GRACE_DAYS_KEY, softDeleteGraceDaysConfig);
    }
  }
}
