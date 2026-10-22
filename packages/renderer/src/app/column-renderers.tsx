// Column-Renderer-Map: client-side lookup for ListColumn columns that specify a
// PlatformComponent renderer (`{ react: { __component: "Name" } }`) in the schema
// instead of a string function. createKumikoApp in renderer/web collects all
// clientFeatures.columnRenderers and mounts the provider; the DataTable cell
// renderer looks up the component through `useColumnRenderer(name)`.
//
// Like CustomScreensProvider, the renderer web bootstrap mounts both providers
// at the same location. Schemas remain serializable: the component is referenced
// only by string key, while the map exists solely on the client.

import { type ComponentType, createContext, type ReactNode, useContext } from "react";

// Props passed to a column-renderer component. `value` is the column's cell
// value (the raw field value from the row), while `row` is the entire row as a
// plain object—a convenience for renderers that need to access other columns
// (for example, a status badge that uses the creation timestamp from the row).
// `column.field` is the field name, which is useful for generic renderers such
// as a JSON pretty-printer or a debug renderer that displays the field name.
export type ColumnRendererProps = {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly column: {
    readonly field: string;
  };
  /** Set only when the caller (DataTable's `onCellChange`) wired an
   *  editable path for this cell — undefined means read-only. A renderer
   *  can branch its own markup (input vs. plain text) on presence alone. */
  readonly onChange?: (value: unknown) => void;
};

export type ColumnRendererComponent = ComponentType<ColumnRendererProps>;

export type ColumnRenderersMap = Readonly<Record<string, ColumnRendererComponent>>;

const ColumnRenderersContext = createContext<ColumnRenderersMap | undefined>(undefined);

export type ColumnRenderersProviderProps = {
  readonly children: ReactNode;
  readonly value: ColumnRenderersMap;
};

export function ColumnRenderersProvider({
  children,
  value,
}: ColumnRenderersProviderProps): ReactNode {
  return (
    <ColumnRenderersContext.Provider value={value}>{children}</ColumnRenderersContext.Provider>
  );
}

/** Looks up the component for a renderer key. Returns undefined when `name` is
 *  empty/undefined (the caller has no __component renderer), or when no provider
 *  is mounted or the key is absent from the map. The caller (DataTable.renderCell)
 *  then logs a warning and falls back to the default type renderer.
 *
 *  `name` is optional so callers can invoke the hook unconditionally—Rules of
 *  Hooks prohibit a function branch that skips the hook. This keeps the call to
 *  a single line without requiring the caller to provide a stub key such as `""`. */
export function useColumnRenderer(name?: string): ColumnRendererComponent | undefined {
  const map = useContext(ColumnRenderersContext);
  if (name === undefined || name === "") return undefined;
  if (map === undefined) return undefined;
  return map[name];
}
