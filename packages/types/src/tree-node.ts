// TreeNode — a single node in the client nav-provider tree. Providers return
// either static readonly TreeNode[] or dynamic TreeChildrenSubscribe.
//
// **Mental model** (VS Code Explorer):
//   [icon] [label] [...hover-actions]
// An optional target makes the node clickable (opening an editor form via
// the target resolver), and optional children form a nested tree.
//
// **State** selects the visual mode for the skeleton pattern:
//   - "filled" (default) — black; the node has content
//   - "stub" — light gray; existing but empty (designer stub file)
//   - "empty" — placeholder for the "+ create" affordance
//   - "loading" — children are currently being resolved
//   - "error" — the provider emitted an error
// Providers that do not need the skeleton pattern can omit state.
//
// **Subscribe form** for dynamic children: the provider receives emit()
// and returns unsubscribe(). The initial emit may be synchronous or async;
// further emits may occur arbitrarily often (for example, when an entity row
// appears through SSE). This works with the existing SSE frame: a provider
// can subscribe internally to entity-update events and call emit() on change.

import type { TargetRef } from "./target-ref.ts";

export type TreeNodeState = "filled" | "stub" | "empty" | "loading" | "error";

type TreeActionBase = {
  // Icon key interpreted by the renderer's icon registry. The convention
  // matches NavDefinition.icon: unknown icons appear as missing-icon
  // in the UI rather than causing a boot failure.
  readonly icon: string;
  // i18n translation key or raw string. The renderer resolves it; the engine
  // treats it as opaque (mirroring NavDefinition.label and WorkspaceDefinition.label).
  readonly label: string;
};

// Exactly one of `screen`/`target`: a route link or an EditorPanel
// click-dispatch. The boot validator still guards untyped input.
export type TreeAction = TreeActionBase &
  (
    | {
        // Qualified screen name ("<feature>:screen:<id>").
        readonly screen: string;
        readonly target?: never;
      }
    | { readonly target: TargetRef; readonly screen?: never }
  );

export type TreeNode = {
  // i18n translation key or raw string, resolved by the renderer during
  // rendering (see TreeAction.label).
  readonly label: string;
  // Optional icon displayed to the left of the label. Uses the same
  // convention as TreeAction.icon and is looked up in the renderer's icon registry.
  readonly icon?: string;
  // Visual state for the skeleton pattern. Defaults to "filled" (no entry
  // means black/normal). See this file's header comment for the value semantics.
  readonly state?: TreeNodeState;
  // Optional click target. If absent, this is a pure container node (expandable
  // but not clickable). If present, clicking opens the editor form through the
  // target resolver in renderer/web.
  readonly target?: TargetRef;
  // Hover actions displayed on the right. They become visible in the sidebar
  // row only on hover, following the VS Code pattern. The engine orders them
  // in the sequence specified here.
  readonly actions?: readonly TreeAction[];
  // Static children or a dynamic Subscribe function. The function is called
  // only when the node is expanded (lazily), allowing SSE-fed live updates
  // when new entity rows arrive.
  readonly children?: readonly TreeNode[] | TreeChildrenSubscribe;
  // Provider-declared "+ create" action for nodes with `state: "empty"`.
  // The tree component automatically shows a "+" icon; click navigates to
  // `createAction.screen` or dispatches `createAction.target` — the
  // provider knows what "create empty" means for it (e.g. "new page slug"
  // vs. "new entity row"), convention couldn't guess that. Consistent with
  // `state` (also provider-explicit).
  readonly createAction?: TreeAction;
};

// Subscribe<T> — the provider calls emit(initial), then ...emit(updated),
// and returns an unsubscribe function. The caller (tree component) calls
// unsubscribe when the node is unmounted or collapsed.
//
// **emitError**: optional callback for async error paths (fetch failure,
// SSE disconnect). Providers that explicitly signal errors call `emitError(e)`
// instead of emitting an empty value; VisualTree displays an error banner
// with a retry button. Synchronous throws in the provider body are caught by
// the useEffect try/catch; emitError is only for async errors.
export type Subscribe<T> = (
  emit: (value: T) => void,
  emitError?: (error: Error) => void,
) => () => void;

// TreeChildrenSubscribe — lazy variant for dynamic children. It is called
// only when the node is expanded in the UI. There is no ctx argument because
// providers are session-bound; the backend reads tenantId from the session
// for each fetch/dispatch. An earlier ctx with tenantId did not carry the
// real tenant in the browser because it was pinned to SYSTEM_TENANT_ID, and
// the only consumer (text-content) ignored it. If a provider later needs
// tenant-aware rendering (for example, cross-tenant dashboards for
// SystemAdmin), ctx can be reintroduced with a real tenant source from the
// auth layer. YAGNI until then.
export type TreeChildrenSubscribe = () => Subscribe<readonly TreeNode[]>;

// TreeActionDef — schema entry for each action in a feature's treeActions
// map. Args are an optional type sample (there is no runtime validator;
// validation occurs at compile time through the buildTarget generic and at
// runtime through the Editor-Panel schema).
//
// This type lives here rather than in build-target.ts because it belongs
// conceptually to the visual-tree domain, not the builder. build-target.ts
// imports the type from here.
export type TreeActionDef<TArgs = Record<string, unknown>> = {
  readonly args?: TArgs;
};

// TreeActionsHandle<T> is the return type of r.treeActions(...). It carries
// the literal-typed action map through the feature export system (see
// FeatureDefinition.exports). It is the compile-time bridge to buildTarget:
//
//   const handle = r.treeActions({ edit: { args: { slug: "" as string } } });
//   // handle.id        → TFeature (literal feature name)
//   // handle.treeActions → { edit: { args: { slug: string } } } (literal-typed)
//   buildTarget({ target: handle, action: "edit", args: { slug: "x" } });
//   //                                ^^^^^^^^^^^^^^         ^^^^^^^^
//   //                                literal-validated      typed-validated
//
// Runtime lookup goes through FeatureDefinition.treeActions (erased map),
// compile-time validation through this handle.
export type TreeActionsHandle<
  TFeature extends string,
  TActions extends Record<string, TreeActionDef>,
> = {
  readonly id: TFeature;
  readonly treeActions: TActions;
};
