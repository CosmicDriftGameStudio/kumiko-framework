import type { AccessRule } from "./handlers";

// Screen definitions describe how a feature surfaces data to the user.
// Pure data — the engine stores these verbatim and ui-core / the renderer
// packages decide what to do with them. The framework must not import
// React / react-native from here; renderer components stay opaque so
// `engine/` imports don't pull the whole UI toolchain into every bundle.

// Per-platform renderer components attached to a screen/slot/route. Both
// fields are `unknown` so the engine can't depend on React types; ui-core
// resolves the platform at mount-time. Framework code only checks
// structural presence.
export type ScreenComponent = {
  readonly react?: unknown;
  readonly native?: unknown;
};

// Level-2 field renderer (ui-architecture.md §Renderer Customization):
//   - ScreenComponent → platform-specific component from the same feature
//   - string            → cross-feature QN reference (resolved by the renderer)
//   - function          → inline value formatter (e.g. `v => `${v} €``)
export type FieldRenderer = ScreenComponent | string | ((value: unknown) => string);

// Conditional field-state evaluator. `data` is the current form row and
// `ctx` carries user / session info — the form-controller in ui-core passes
// both at evaluation time. Engine-side defaults are `unknown` because the
// framework has nothing to assert about the shapes; feature code can narrow
// them by passing type args (e.g. `FieldCondition<OrderRow>`) to skip the
// cast at call sites.
export type FieldCondition<TData = unknown, TCtx = unknown> = (data: TData, ctx: TCtx) => boolean;

// --- entityList ---

// `string` shorthand when the column only needs its field name; the object
// form carries renderer / display overrides. normalizeListColumn() below
// collapses both into the object form for downstream consumers.
export type ListColumnSpec =
  | string
  | {
      readonly field: string;
      readonly renderer?: FieldRenderer;
    };

export type EntityListScreenDefinition = {
  readonly id: string;
  readonly type: "entityList";
  readonly entity: string;
  readonly columns: readonly ListColumnSpec[];
  // Row renderer (Desktop) — when omitted, renderer draws the default table
  // from `columns`. cardRenderer fills the same role on compact layouts.
  readonly rowRenderer?: ScreenComponent;
  readonly cardRenderer?: ScreenComponent;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- entityEdit ---

export type EditFieldSpec =
  | string
  | {
      readonly field: string;
      readonly span?: number;
      readonly visible?: FieldCondition;
      readonly readonly?: FieldCondition;
      readonly required?: FieldCondition;
      readonly renderer?: FieldRenderer;
    };

export type EditSectionSpec = {
  readonly title: string;
  readonly columns?: number;
  readonly fields: readonly EditFieldSpec[];
};

export type EditLayout = {
  readonly sections: readonly EditSectionSpec[];
};

export type EntityEditScreenDefinition = {
  readonly id: string;
  readonly type: "entityEdit";
  readonly entity: string;
  readonly layout: EditLayout;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

// --- custom ---

// Sub-route declared by a custom screen (Expo Router / URL-routing use).
// `path` is the route-segment appended to the screen's own path; the
// framework owns the outer routing. Components stay opaque.
export type CustomScreenRoute = {
  readonly path: string;
  readonly component: ScreenComponent;
};

export type CustomScreenDefinition = {
  readonly id: string;
  readonly type: "custom";
  readonly renderer: ScreenComponent;
  readonly routes?: readonly CustomScreenRoute[];
  readonly access?: AccessRule;
};

// --- shared slots (Level 4 from ui-architecture.md) ---

export type ScreenSlots = {
  readonly header?: ScreenComponent;
  readonly beforeForm?: ScreenComponent;
  readonly afterForm?: ScreenComponent;
  readonly sidebar?: ScreenComponent;
  readonly footer?: ScreenComponent;
  readonly toolbar?: ScreenComponent;
};

// --- discriminated union ---

export type ScreenDefinition =
  | EntityListScreenDefinition
  | EntityEditScreenDefinition
  | CustomScreenDefinition;

// Collapse the string-shorthand into the object form. Both the boot-validator
// and (later) ui-core's view-model builder iterate over fields/columns — the
// helper keeps that loop from growing two branches everywhere.
export function normalizeListColumn(c: ListColumnSpec): Exclude<ListColumnSpec, string> {
  return typeof c === "string" ? { field: c } : c;
}

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
