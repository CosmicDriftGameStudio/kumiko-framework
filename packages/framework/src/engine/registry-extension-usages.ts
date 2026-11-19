import type {
  RegistrarExtensionDef,
  RegistrarExtensionHooks,
  RegistrarExtensionRegistration,
} from "@cosmicdrift/kumiko-types/config";
import type {
  PostDeleteHookFn,
  PostSaveHookFn,
  PreDeleteHookFn,
  PreSaveHookFn,
} from "@cosmicdrift/kumiko-types/hooks";
import { bindHookEscapeHatchGrant } from "../pipeline/system-identity-switch.ts";
import { HookPhases } from "./hook-helpers.ts";
import type { RegistryState } from "./registry-state.ts";

// Owner "*" = always-enabled, not gated by feature-toggles. Extensions
// are plumbing (e.g. ownership) — the feature that declared them might
// itself be toggleable, but the extension-hook is conceptually part of
// the entity's invariants. If future requirements need extension hooks
// to also be gated, store the registering-feature on
// RegistrarExtensionRegistration and use that here.
const EXTENSION_HOOK_OWNER = "*";

function applyExtensionSchema(
  state: RegistryState,
  ext: RegistrarExtensionDef,
  usage: RegistrarExtensionRegistration,
): void {
  if (!ext.extendSchema) return;
  const entity = state.entityMap.get(usage.entityName);
  if (entity) {
    const extraFields = ext.extendSchema(usage.entityName);
    const merged = { ...entity, fields: { ...entity.fields, ...extraFields } };
    state.entityMap.set(usage.entityName, merged);
  }
}

// Unlike export/forget hooks (escapeHatch on r.applyExtension(...)), these
// entity-lifecycle wrappers (postSave/preDelete/postDelete/preSave) have no
// escapeHatch declaration site, so SYSTEM stays denied here (system-identity-switch.ts).
function registerExtensionEntityHooks(
  state: RegistryState,
  hooks: RegistrarExtensionHooks,
  usage: RegistrarExtensionRegistration,
): void {
  if (hooks.postSave) {
    const wrapped = bindHookEscapeHatchGrant(
      hooks.postSave,
      `postSave hook of extension "${usage.extensionName}"`,
      undefined,
    ) as PostSaveHookFn; // @cast-boundary engine-bridge
    const existing = state.entityPostSaveHooks.get(usage.entityName) ?? [];
    existing.push({
      fn: wrapped,
      phase: HookPhases.afterCommit,
      featureName: EXTENSION_HOOK_OWNER,
    });
    state.entityPostSaveHooks.set(usage.entityName, existing);
  }
  if (hooks.preDelete) {
    const wrapped = bindHookEscapeHatchGrant(
      hooks.preDelete,
      `preDelete hook of extension "${usage.extensionName}"`,
      undefined,
    ) as PreDeleteHookFn; // @cast-boundary engine-bridge
    const existing = state.entityPreDeleteHooks.get(usage.entityName) ?? [];
    existing.push({
      fn: wrapped,
      phase: HookPhases.afterCommit,
      featureName: EXTENSION_HOOK_OWNER,
    });
    state.entityPreDeleteHooks.set(usage.entityName, existing);
  }
  if (hooks.postDelete) {
    const wrapped = bindHookEscapeHatchGrant(
      hooks.postDelete,
      `postDelete hook of extension "${usage.extensionName}"`,
      undefined,
    ) as PostDeleteHookFn; // @cast-boundary engine-bridge
    const existing = state.entityPostDeleteHooks.get(usage.entityName) ?? [];
    existing.push({
      fn: wrapped,
      phase: HookPhases.afterCommit,
      featureName: EXTENSION_HOOK_OWNER,
    });
    state.entityPostDeleteHooks.set(usage.entityName, existing);
  }
  // preSave on extensions: store as handler hook for all CRUD handlers of this entity
  if (hooks.preSave) {
    const wrapped = bindHookEscapeHatchGrant(
      hooks.preSave,
      `preSave hook of extension "${usage.extensionName}"`,
      undefined,
    ) as PreSaveHookFn; // @cast-boundary engine-bridge
    for (const qualifiedHandler of state.writeHandlerMap.keys()) {
      if (state.handlerEntityMap.get(qualifiedHandler) === usage.entityName) {
        const existing = state.preSaveHooks.get(qualifiedHandler) ?? [];
        existing.push({ fn: wrapped, featureName: EXTENSION_HOOK_OWNER });
        state.preSaveHooks.set(qualifiedHandler, existing);
      }
    }
  }
}

// Process extension usages: call onRegister, apply extendSchema, register hooks.
export function applyExtensionUsages(state: RegistryState): void {
  for (const usage of state.extensionUsages) {
    const ext = state.extensionMap.get(usage.extensionName);
    if (!ext) continue;

    if (ext.onRegister) {
      ext.onRegister(usage.entityName, usage.options);
    }

    applyExtensionSchema(state, ext, usage);

    if (ext.hooks) {
      registerExtensionEntityHooks(state, ext.hooks, usage);
    }
  }
}
