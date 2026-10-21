// Extension-section component map: client-side lookup for entityEdit
// sections of type `extension`, list-header slots, and Dashboard-`custom`
// panels. Each mount location resolves the `__component` name from a
// PlatformComponent through the same registry and mounts the matching
// component — the bundled feature/app component then loads and persists
// its own data (e.g. custom fields or a standalone chart).
// The entityEdit footer slot (`screen.slots.footer`) mounts through it too.
//
// Mounting follows the CustomScreensProvider pattern — createKumikoApp in
// renderer/web collects all clientFeatures.extensionSectionComponents and
// mounts the provider; tests that need to inspect individual sections can
// mount the provider directly.

import type { PlatformComponent } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ComponentType, createContext, type ReactNode, useContext } from "react";

/** Extracts the `__component` name from a PlatformComponent. Reads the
 *  react and native branches (the app author registers both under the same
 *  name); returns the first string found. Pure narrowing via `in` — no cast
 *  or assertion. */
export function extensionSectionName(component: PlatformComponent): string | undefined {
  for (const branch of [component.react, component.native]) {
    if (branch !== null && typeof branch === "object" && "__component" in branch) {
      const candidate = branch.__component;
      if (typeof candidate === "string") return candidate;
    }
  }
  return undefined;
}

export type ExtensionSectionProps = {
  readonly entityName: string;
  readonly entityId: string | null;
  /** Previously saved extension values for the entity (passed through from
   *  the loaded detail row). `undefined` in create mode or when the host
   *  screen provides no values. Allows the section to display existing
   *  values while editing instead of being write-only. */
  readonly initialValues?: Readonly<Record<string, unknown>>;
  /** Set only in the list-header slot (`entityId` is null): the list's
   *  `screen.id`, so a header control can access the per-screen URL filter
   *  state (`useListUrlState`) — for example, a tag filter that narrows the
   *  list to a set of IDs. `undefined` in entityEdit sections. */
  readonly screenId?: string;
  /** Set only in a Dashboard-`custom` panel: the currently selected value
   *  of the screen filter (see DashboardFilterDefinition), merged as with any
   *  other panel query. `undefined` in all other mount locations. Dashboard
   *  panels have no entity — `entityName`/`entityId` contain the `screen.id`
   *  and `null`, respectively; see CustomPanelBody in dashboard-body.tsx. */
  readonly filterParams?: Readonly<Record<string, unknown>>;
  /** Current form values of the host RenderEdit (controlled mode) — same snapshot reference as
   *  `RenderEditChangeState.values`. Lets the section read the host
   *  form's live state (e.g. for a review step). Only set in
   *  entityEdit sections; undefined in list-header and dashboard
   *  mounts, where no host form exists. */
  readonly values?: Readonly<Record<string, unknown>>;
  /** Sets host RenderEdit form values from outside (e.g. a VIN-decode
   *  roundtrip that fills other fields) — same function as
   *  `RenderEditControls.patch`, merges only the given keys. `patch` must
   *  converge: `setValues` is a no-op only when the merged result is
   *  reference-equal to the current values, so an unconditional
   *  `patch(...)` from a `values`-dependent effect loops. Undefined outside
   *  entityEdit sections. */
  readonly patch?: (partial: Readonly<Record<string, unknown>>) => void;
  /** Validates the host form without writing — same function as
   *  `RenderEditControls.validate`; field errors land in
   *  `snapshot.errors` on the field instead of a collective message.
   *  Undefined outside entityEdit sections. */
  readonly validate?: () => boolean;
  /** Marks the current host form values as saved after the section wrote
   *  them itself, so a following navigation does not ask to discard.
   *  Undefined outside entityEdit sections and the entityEdit footer slot. */
  readonly markSaved?: () => void;
  /** Whether the host form has unsaved changes. Only set in the entityEdit
   *  footer slot (`screen.slots.footer`); undefined in all other mounts. */
  readonly hasUnsavedChanges?: boolean;
  /** Current wizard step, only set for `layout.mode === "wizard"` forms.
   *  Only set in the entityEdit footer slot (`screen.slots.footer`);
   *  undefined in all other mounts, and undefined there too for a
   *  non-wizard form. */
  readonly wizardStep?: { readonly index: number; readonly isLast: boolean };
  /** Only set for extension steps of a `layout.mode: "wizard"` entityEdit
   *  editing an existing record (update mode); undefined everywhere else.
   *  Report through `useReportStepComplete(reportStepComplete, complete)`
   *  (`null` while the step's data loads) with whether the step already holds
   *  its data, so the step bar shows the step as done. */
  readonly reportStepComplete?: (complete: boolean) => void;
};

export type ExtensionSectionComponent = ComponentType<ExtensionSectionProps>;

export type ExtensionSectionsMap = Readonly<Record<string, ExtensionSectionComponent>>;

const ExtensionSectionsContext = createContext<ExtensionSectionsMap | undefined>(undefined);

export type ExtensionSectionsProviderProps = {
  readonly children: ReactNode;
  readonly value: ExtensionSectionsMap;
};

export function ExtensionSectionsProvider({
  children,
  value,
}: ExtensionSectionsProviderProps): ReactNode {
  return (
    <ExtensionSectionsContext.Provider value={value}>{children}</ExtensionSectionsContext.Provider>
  );
}

/** Looks up the component for an extension-section name. Returns
 *  `undefined` when no provider is mounted or the name is not registered in
 *  the map — the caller (RenderEdit) then displays its placeholder banner.
 *  `name` is optional so callers can invoke the hook unconditionally
 *  (Rules-of-Hooks) without supplying a stub key such as `""`, analogous to
 *  `useColumnRenderer`. */
export function useExtensionSectionComponent(name?: string): ExtensionSectionComponent | undefined {
  const map = useContext(ExtensionSectionsContext);
  if (name === undefined || name === "") return undefined;
  if (map === undefined) return undefined;
  return map[name];
}
