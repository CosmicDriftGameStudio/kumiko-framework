import { resolveTableName } from "../db/entity-table-meta";
import { buildMetricName, validateMetricName } from "../observability";
import type { RegistryState } from "./registry-state";
import { mergeHookList, mergeHookListQualified, qualify } from "./registry-state";
import type { FeatureDefinition } from "./types";

// Feature registration + entities (globally-unique, physical-table-checked) + relations
// (additive per entity, duplicate-per-name guarded).
export function populateFeatureCore(state: RegistryState, feature: FeatureDefinition): void {
  if (state.featureMap.has(feature.name)) {
    throw new Error(`Duplicate feature: "${feature.name}"`);
  }
  state.featureMap.set(feature.name, feature);

  // Entities: NOT prefixed — entity names must be globally unique
  for (const [name, entity] of Object.entries(feature.entities ?? {})) {
    if (state.entityMap.has(name)) {
      throw new Error(`Duplicate entity: "${name}" (registered by multiple features)`);
    }
    state.entityMap.set(name, entity);
    const physical = resolveTableName(name, entity, feature.name);
    const clash = state.physicalTableOwners.get(physical);
    if (clash?.kind === "unmanaged") {
      throw new Error(
        `Entity "${name}" (feature "${feature.name}") has physical table "${physical}" which ` +
          `collides with r.unmanagedTable("${physical}") (feature "${clash.featureName}"). ` +
          `Pick a different tableName — both would emit CREATE TABLE "${physical}".`,
      );
    }
    // Entity-vs-entity ist genauso fatal: zwei Entities mit explizitem,
    // identischem tableName überschrieben sich hier vorher still —
    // doppeltes CREATE TABLE bzw. eine Projektion frisst die andere.
    if (clash?.kind === "entity") {
      throw new Error(
        `Entity "${name}" (feature "${feature.name}") has physical table "${physical}" which ` +
          `collides with entity "${clash.owner}" (feature "${clash.featureName}"). ` +
          `Pick a different tableName — both would project into "${physical}".`,
      );
    }
    state.physicalTableOwners.set(physical, {
      kind: "entity",
      owner: name,
      featureName: feature.name,
    });
  }

  // Relations: entityName (not prefixed)
  for (const [entityName, rels] of Object.entries(feature.relations ?? {})) {
    const existing = state.relationMap.get(entityName) ?? {};
    for (const [relName, relDef] of Object.entries(rels)) {
      if (existing[relName]) {
        throw new Error(
          `Duplicate relation: "${entityName}.${relName}" (registered by multiple features)`,
        );
      }
      existing[relName] = relDef;
    }
    state.relationMap.set(entityName, existing);
  }
}

// Write + query handlers: qualified scope:type:name, duplicate-guarded.
export function populateHandlers(state: RegistryState, feature: FeatureDefinition): void {
  // Write handlers: scope:write:name
  for (const [name, handler] of Object.entries(feature.writeHandlers ?? {})) {
    const qualified = qualify(feature.name, "write", name);
    if (state.writeHandlerMap.has(qualified)) {
      throw new Error(`Duplicate write handler: "${qualified}" (registered by multiple features)`);
    }
    state.writeHandlerMap.set(qualified, { ...handler, name: qualified });
    state.handlerFeatureMap.set(qualified, feature.name);
  }

  // Query handlers: scope:query:name
  for (const [name, handler] of Object.entries(feature.queryHandlers ?? {})) {
    const qualified = qualify(feature.name, "query", name);
    if (state.queryHandlerMap.has(qualified)) {
      throw new Error(`Duplicate query handler: "${qualified}" (registered by multiple features)`);
    }
    state.queryHandlerMap.set(qualified, { ...handler, name: qualified });
    state.handlerFeatureMap.set(qualified, feature.name);
  }
}

// Config keys: scope:config:name, duplicate-guarded.
export function populateConfigKeys(state: RegistryState, feature: FeatureDefinition): void {
  // Config keys: scope:config:name
  for (const [key, keyDef] of Object.entries(feature.configKeys ?? {})) {
    const qualifiedKey = qualify(feature.name, "config", key);
    if (state.configKeyMap.has(qualifiedKey)) {
      throw new Error(`Duplicate config key: "${qualifiedKey}" (registered by multiple features)`);
    }
    state.configKeyMap.set(qualifiedKey, keyDef);
  }
}

// Jobs (runIn-pinned, duplicate-guarded) + notifications (trigger resolved later).
export function populateJobsAndNotifications(
  state: RegistryState,
  feature: FeatureDefinition,
): void {
  // Jobs: scope:job:name
  for (const [name, jobDef] of Object.entries(feature.jobs ?? {})) {
    const qualifiedName = qualify(feature.name, "job", name);
    if (state.jobMap.has(qualifiedName)) {
      throw new Error(`Duplicate job: "${qualifiedName}" (registered by multiple features)`);
    }
    // runIn runtime-check. TS's JobRunIn = Exclude<RunIn, "both"> already
    // rejects "both" at compile time, but dynamically-constructed jobs
    // (serialized config, plugin authors using `as any`) could slip it
    // past the type system. Fail loud — "both" for jobs would mean "fan
    // out to both lane-queues", which over-delivers; the routing assumes
    // exactly one target queue per dispatch.
    // @cast-boundary schema-walk — defensive runtime-check against bypassed type-system
    const runIn = (jobDef as { runIn?: unknown }).runIn;
    if (runIn !== undefined && runIn !== "api" && runIn !== "worker") {
      throw new Error(
        `Invalid runIn "${String(runIn)}" on job "${qualifiedName}" — jobs must be pinned to a single lane ("api" or "worker"). "both" is not allowed because BullMQ queues are lane-scoped.`,
      );
    }
    state.jobMap.set(qualifiedName, { ...jobDef, name: qualifiedName });
  }

  // Notifications: scope:notify:name
  for (const [name, notifDef] of Object.entries(feature.notifications ?? {})) {
    const qualifiedName = qualify(feature.name, "notify", name);
    state.notificationMap.set(qualifiedName, {
      ...notifDef,
      name: qualifiedName,
      trigger: { on: notifDef.trigger.on },
    });
    state.notificationFeatureMap.set(qualifiedName, feature.name);
  }
}

// Events: scope:event:name. Upcaster chains stitched after full ingest (see validateEventUpcasters).
export function populateEvents(state: RegistryState, feature: FeatureDefinition): void {
  // Events: scope:event:name. Migrations stay keyed by feature+short-name
  // in the FeatureDefinition and get stitched into the state.eventUpcasterMap
  // below (after ALL features are ingested) so cross-feature validation has
  // the complete picture.
  for (const [eventName, eventDef] of Object.entries(feature.events ?? {})) {
    const qualified = qualify(feature.name, "event", eventName);
    state.eventMap.set(qualified, { ...eventDef, name: qualified });
  }
}

export function populateTranslations(state: RegistryState, feature: FeatureDefinition): void {
  // Translations prefixed with featureName: (i18next namespace convention).
  // Keys that already carry the feature's own namespace prefix (e.g. a nav
  // label referencing "cap-counter:nav.cap-list" verbatim) must NOT be
  // re-prefixed, else server-side t() can never resolve them (#1105).
  const prefix = `${feature.name}:`;
  for (const [key, value] of Object.entries(feature.translations ?? {})) {
    const qualifiedKey = key.startsWith(prefix) ? key : `${prefix}${key}`;
    state.mergedTranslations[qualifiedKey] = value;
  }
}

// Lifecycle hooks (handler-targeted, qualified) + entity hooks (entity-targeted,
// unprefixed) + search-payload-extensions (additive per entity).
export function populateHooks(state: RegistryState, feature: FeatureDefinition): void {
  // Lifecycle hooks: keyed by handler QN. featureName rides along on each
  // hook entry — defineFeature sets it, the registry just appends.
  // Save/delete hooks target write handlers, query hooks target query handlers.
  mergeHookListQualified(state.preSaveHooks, feature.hooks?.preSave, feature.name, "write");
  mergeHookListQualified(state.postSaveHooks, feature.hooks?.postSave, feature.name, "write");
  mergeHookListQualified(state.preDeleteHooks, feature.hooks?.preDelete, feature.name, "write");
  mergeHookListQualified(state.postDeleteHooks, feature.hooks?.postDelete, feature.name, "write");
  mergeHookListQualified(state.preQueryHooks, feature.hooks?.preQuery, feature.name, "query");
  mergeHookListQualified(state.postQueryHooks, feature.hooks?.postQuery, feature.name, "query");

  // Entity hooks: NOT prefixed, keyed by entity name
  mergeHookList(state.entityPostSaveHooks, feature.entityHooks?.postSave);
  mergeHookList(state.entityPreDeleteHooks, feature.entityHooks?.preDelete);
  mergeHookList(state.entityPostDeleteHooks, feature.entityHooks?.postDelete);
  mergeHookList(state.entityPostQueryHooks, feature.entityHooks?.postQuery);

  // F3 search-payload-extensions: per-entity contributors merged additively
  for (const [entityName, contributors] of Object.entries(feature.searchPayloadExtensions ?? {})) {
    const existing = state.searchPayloadExtensions.get(entityName) ?? [];
    for (const c of contributors) existing.push(c);
    state.searchPayloadExtensions.set(entityName, existing);
  }
}

// Registrar extension definitions + usages + selectors + reference-data + config-seeds.
export function populateExtensionsAndSeeds(state: RegistryState, feature: FeatureDefinition): void {
  // Registrar extensions: collect definitions and usages
  for (const [extName, extDef] of Object.entries(feature.registrarExtensions ?? {})) {
    if (state.extensionMap.has(extName)) {
      throw new Error(
        `Duplicate registrar extension: "${extName}" (registered by multiple features)`,
      );
    }
    state.extensionMap.set(extName, extDef);
  }
  // Annotate the owner so consumers (readiness gating) can map a
  // registration back to the feature's config keys + secrets.
  state.extensionUsages.push(
    ...(feature.extensionUsages ?? []).map((u) => ({ ...u, featureName: feature.name })),
  );
  for (const sel of feature.extensionSelectors ?? []) {
    if (state.extensionSelectorMap.has(sel.extensionName)) {
      throw new Error(
        `Duplicate extension selector for "${sel.extensionName}" ` +
          `(feature "${feature.name}") — one owning feature declares the selector.`,
      );
    }
    state.extensionSelectorMap.set(sel.extensionName, sel.qualifiedKey);
  }
  state.allReferenceData.push(...(feature.referenceData ?? []));
  state.allConfigSeeds.push(...(feature.configSeeds ?? []));
}

// Metrics (name-validated, globally-unique) + secret keys (already qualified).
export function populateMetricsAndSecrets(state: RegistryState, feature: FeatureDefinition): void {
  // Metrics: validate + qualify per feature. Collisions across features are
  // rejected here — two features can't both register "created_total" under
  // different shapes (labels/type) because the resulting fully qualified
  // names differ, but same short+feature combo would already fail in
  // defineFeature. This loop catches cross-feature/extension edge cases.
  for (const [shortName, def] of Object.entries(feature.metrics ?? {})) {
    const fullName = buildMetricName(feature.name, shortName);
    validateMetricName(fullName, def.type);
    if (state.metricMap.has(fullName)) {
      throw new Error(
        `[Kumiko Observability] Metric "${fullName}" registered multiple times ` +
          `(Feature: ${feature.name}). Metric names must be globally unique.`,
      );
    }
    state.metricMap.set(fullName, { ...def, featureName: feature.name });
  }

  // Secret keys: already qualified during defineFeature (same "<feature>:<short>"
  // convention used elsewhere). Reject cross-feature duplicates — extensions
  // could theoretically register on another feature's namespace.
  for (const def of Object.values(feature.secretKeys ?? {})) {
    if (state.secretKeyMap.has(def.qualifiedName)) {
      throw new Error(
        `[Kumiko Secrets] Secret key "${def.qualifiedName}" registered multiple times. ` +
          "Secret names must be globally unique across features.",
      );
    }
    state.secretKeyMap.set(def.qualifiedName, def);
  }
}

// Explicit + multi-stream projections (source-entity indexed) + raw tables +
// unmanaged tables (both cross-feature-uniqueness-by-physical-name guarded).
export function populateProjectionsAndTables(
  state: RegistryState,
  feature: FeatureDefinition,
): void {
  // Projections: qualified by feature name. Build the source-entity index so
  // the event-store-executor can fetch matching projections in O(1) per write.
  for (const [projName, projDef] of Object.entries(feature.projections ?? {})) {
    const qualified = qualify(feature.name, "projection", projName);
    if (state.projectionMap.has(qualified)) {
      throw new Error(`Duplicate projection: "${qualified}" (registered by multiple features)`);
    }
    const stored = { ...projDef, name: qualified };
    state.projectionMap.set(qualified, stored);
    const sources = Array.isArray(projDef.source) ? projDef.source : [projDef.source];
    for (const src of sources) {
      const existing = state.projectionsBySource.get(src) ?? [];
      existing.push(stored);
      state.projectionsBySource.set(src, existing);
    }
  }

  // Multi-stream projections: qualified + stored for later wiring into
  // event-dispatcher. Namespace is shared with single-stream projections —
  // defineFeature already catches name collisions inside one feature, but
  // we also guard the cross-feature case here.
  for (const [mspName, mspDef] of Object.entries(feature.multiStreamProjections ?? {})) {
    const qualified = qualify(feature.name, "projection", mspName);
    if (state.projectionMap.has(qualified) || state.multiStreamProjectionMap.has(qualified)) {
      throw new Error(`Duplicate projection: "${qualified}" (registered by multiple features)`);
    }
    // runIn runtime-check. TS's RunIn union already enforces the three
    // values at compile time; this guards dynamically-constructed MSPs
    // (config-driven, plugin authors) that could slip a typo through.
    // @cast-boundary schema-walk — defensive runtime-check against bypassed type-system
    const mspRunIn = (mspDef as { runIn?: unknown }).runIn;
    if (
      mspRunIn !== undefined &&
      mspRunIn !== "api" &&
      mspRunIn !== "worker" &&
      mspRunIn !== "both"
    ) {
      throw new Error(
        `Invalid runIn "${String(mspRunIn)}" on MSP "${qualified}" — must be "api", "worker", or "both".`,
      );
    }
    state.multiStreamProjectionMap.set(qualified, { ...mspDef, name: qualified });
    state.multiStreamProjectionFeatureMap.set(qualified, feature.name);
  }

  // Raw tables: aggregated by feature-local short name (unprefixed —
  // these bypass the qualified-name namespace because they have no
  // event-stream binding to disambiguate). Reject cross-feature
  // duplicates at boot so the dev-server doesn't race two CREATE TABLE
  // statements that target the same physical table name.
  for (const [rawName, rawDef] of Object.entries(feature.rawTables ?? {})) {
    const existing = state.rawTableMap.get(rawName);
    if (existing) {
      throw new Error(
        `Raw-table "${rawName}" registered by both feature "${existing.featureName}" and ` +
          `"${feature.name}". Pick a feature-prefixed name to disambiguate.`,
      );
    }
    state.rawTableMap.set(rawName, { ...rawDef, featureName: feature.name });
  }

  // Unmanaged tables — same cross-feature uniqueness invariant as rawTables.
  // Two features registering the same physical tableName would race two
  // CREATE TABLE statements via migrate-runner.
  for (const [umName, umDef] of Object.entries(feature.unmanagedTables ?? {})) {
    const existing = state.unmanagedTableMap.get(umName);
    if (existing) {
      throw new Error(
        `Unmanaged-table "${umName}" registered by both feature "${existing.featureName}" and ` +
          `"${feature.name}". Pick a feature-prefixed tableName to disambiguate.`,
      );
    }
    const physicalClash = state.physicalTableOwners.get(umName);
    if (physicalClash?.kind === "entity") {
      throw new Error(
        `Unmanaged-table "${umName}" (feature "${feature.name}") collides with the physical ` +
          `table of entity "${physicalClash.owner}" (feature "${physicalClash.featureName}"). ` +
          `Pick a different tableName — both would emit CREATE TABLE "${umName}".`,
      );
    }
    const piiFields = umDef.meta.piiSubjectFields ?? [];
    if (piiFields.length > 0 && !umDef.piiEncryptedOnWrite) {
      throw new Error(
        `Unmanaged-table "${umName}" (feature "${feature.name}") has PII-annotated fields ` +
          `(${piiFields.join(", ")}) but direct writes bypass the executor's PII encryption. ` +
          `Encrypt those fields before every insert/update (encryptPiiFieldValues) and declare ` +
          `{ piiEncryptedOnWrite: true }, or drop the subject annotations.`,
      );
    }
    state.physicalTableOwners.set(umName, {
      kind: "unmanaged",
      owner: umName,
      featureName: feature.name,
    });
    state.unmanagedTableMap.set(umName, { ...umDef, featureName: feature.name });
  }
}

// Claim keys + auth-claims hooks (declaredShortNames threads the auto-prefix
// warning-set from claim-key declarations into the hooks registered right after —
// reordered next to each other; originally separated by the screens/nav/workspace
// block below, which has no dependency on either).
export function populateClaimsAndAuth(state: RegistryState, feature: FeatureDefinition): void {
  // Claim keys: aggregated by qualified name. Two features cannot collide
  // here (qualified by feature name), but we still guard for explicit
  // correctness — the only way to hit this is a hand-built FeatureDefinition
  // bypassing defineFeature's per-feature duplicate check.
  const declaredShortNames = new Set<string>();
  for (const def of Object.values(feature.claimKeys ?? {})) {
    if (state.claimKeyMap.has(def.qualifiedName)) {
      throw new Error(
        `[Kumiko ClaimKeys] Claim key "${def.qualifiedName}" registered multiple times. ` +
          "Claim short-names must be globally unique across features.",
      );
    }
    state.claimKeyMap.set(def.qualifiedName, def);
    declaredShortNames.add(def.shortName);
  }
  // Auth-claims hooks: order of registration is preserved. Feature name is
  // captured alongside so the resolver can apply the auto-prefix at merge
  // time — the feature author never ships pre-prefixed keys.
  //
  // If the feature declared ANY claim keys, every hook from that feature
  // gets the declaredShortNames set attached. The resolver uses it to warn
  // on undeclared inner-keys (typo / rename drift). Features that don't
  // declare claimKeys skip the check entirely — it's opt-in.
  const declaredKeys = declaredShortNames.size > 0 ? declaredShortNames : undefined;
  for (const fn of feature.authClaimsHooks ?? []) {
    state.authClaimsHooks.push({
      featureName: feature.name,
      fn,
      ...(declaredKeys && { declaredKeys }),
    });
  }
}

// Screens + nav (qualified, entity/parent indexed) + workspaces (nav membership
// pass 1 — pass 2 folds self-assigned nav entries in after full ingest, see
// finalizeWorkspaceNavMembership) + tree-actions (at-most-one per feature).
export function populateScreensNavWorkspaces(
  state: RegistryState,
  feature: FeatureDefinition,
): void {
  // Screens: qualified + stored. Uniqueness per-feature is enforced in
  // defineFeature; cross-feature collisions are impossible because the
  // qualified name includes the feature-prefix. The separate state.featureMap
  // entry lets the nav resolver pause screens owned by disabled features
  // in O(1) without walking every screen.
  for (const [screenId, screenDef] of Object.entries(feature.screens ?? {})) {
    const qualified = qualify(feature.name, "screen", screenId);
    // Stored version overwrites `id` with the qualified name so callers
    // never need a reverse index (NavDef → qn) during tree-walking.
    // Same pattern as state.writeHandlerMap/state.projectionMap/state.multiStreamProjectionMap
    // (see `{ ...def, name: qualified }` above). Feature-side
    // `feature.screens[shortId]` keeps the short id — only the registry
    // surface flips.
    const stored = { ...screenDef, id: qualified };
    state.screenMap.set(qualified, stored);
    state.screenFeatureMap.set(qualified, feature.name);
    // entity-Index nur für Screens die direkt an einer Entity hängen.
    // entityList/entityEdit haben `entity`; custom + actionForm haben
    // keinen entity-Bezug (custom ist opaque, actionForm hat inline
    // fields ohne Entity-Reference).
    if (stored.type === "entityList" || stored.type === "entityEdit") {
      const existing = state.screensByEntity.get(stored.entity) ?? [];
      existing.push(stored);
      state.screensByEntity.set(stored.entity, existing);
    }
  }

  // Nav entries: same qualification pattern as screens. The parent/screen
  // refs are boot-validated below (after all features are ingested, so
  // cross-feature parents can resolve). parent-index is built in the same
  // loop because `parent` refers to a qualified name that doesn't need
  // resolution — just string equality with whatever's in the target
  // entry's QN.
  for (const [navId, navDef] of Object.entries(feature.navs ?? {})) {
    const qualified = qualify(feature.name, "nav", navId);
    // See screens above — stored version carries the qualified id so
    // resolveNavigation can recurse via getNavsByParent(child.id) without
    // hand-building a reverse index.
    const stored = { ...navDef, id: qualified };
    state.navMap.set(qualified, stored);
    state.navFeatureMap.set(qualified, feature.name);
    if (stored.parent === undefined) {
      state.topLevelNavs.push(stored);
    } else {
      const existing = state.navsByParent.get(stored.parent) ?? [];
      existing.push(stored);
      state.navsByParent.set(stored.parent, existing);
    }
  }

  // Workspaces: same qualification pattern as nav/screen. Step one stores
  // the workspace itself + its explicit nav list; step two (after every
  // feature has been ingested) folds nav-self-assigned QNs into the same
  // member list. Doing it in two passes keeps cross-feature workspace
  // refs valid — a nav entry can self-assign to a workspace whose feature
  // hasn't been ingested yet.
  for (const [wsId, wsDef] of Object.entries(feature.workspaces ?? {})) {
    const qualified = qualify(feature.name, "workspace", wsId);
    const stored = { ...wsDef, id: qualified };
    state.workspaceMap.set(qualified, stored);
    state.workspaceFeatureMap.set(qualified, feature.name);
    // Seed the membership list with the workspace's explicit nav refs in
    // declaration order. Boot-validator checks the QNs resolve.
    state.navsByWorkspace.set(qualified, [...(stored.nav ?? [])]);
    if (stored.default === true) {
      // Boot-validator enforces uniqueness; here we just remember the
      // first one and let validateBoot complain if there's a second.
      if (state.defaultWorkspace === undefined) {
        state.defaultWorkspace = stored;
      }
    }
  }

  // Tree-Actions slot — at-most-one per feature (only-once-guard im
  // registrar). Erased Map für Runtime-Lookup; compile-time-typed
  // Surface läuft über FeatureDefinition.exports (TreeActionsHandle).
  if (feature.treeActions !== undefined) {
    state.treeActionsMap.set(feature.name, feature.treeActions);
  }
}
