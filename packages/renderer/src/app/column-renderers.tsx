// Column-Renderer-Map: client-side Lookup für ListColumn-Spalten die im
// Schema einen PlatformComponent-Renderer (`{ react: { __component: "Name" } }`)
// statt einer String-Funktion angeben. createKumikoApp im renderer-web sammelt
// alle clientFeatures.columnRenderers und mountet den Provider; der DataTable-
// Cell-Renderer schlägt den Component über `useColumnRenderer(name)` nach.
//
// Analog zu CustomScreensProvider — der Renderer-Web-Bootstrap mounted beide
// Provider an derselben Stelle. Schemas selbst bleiben serializable: der
// Component wird nur per String-Key referenziert, die Map liegt allein
// client-seitig.

import { type ComponentType, createContext, type ReactNode, useContext } from "react";

// Props die ein Column-Renderer-Component bekommt. `value` ist der
// Cell-Value für die Spalte (rohes Field-Value aus der Row), `row` ist
// die ganze Row als plain object — nice-to-have für Renderer die auf
// andere Spalten zugreifen wollen (z.B. Status-Badge der den
// Erstellungs-Zeitpunkt aus der Row mitnimmt). `column.field` ist der
// Field-Name; hilfreich für generische Renderer (JSON-Pretty-Printer
// oder Debug-Renderer die den Feldnamen anzeigen).
export type ColumnRendererProps = {
  readonly value: unknown;
  readonly row: Readonly<Record<string, unknown>>;
  readonly column: {
    readonly field: string;
  };
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

/** Schaut die Component für einen Renderer-Key nach. Returnt undefined
 *  wenn `name` leer/undefined ist (Caller hat keinen __component-Renderer)
 *  oder weder Provider gemounted noch der Key in der Map ist. Der Caller
 *  (DataTable.renderCell) loggt dann eine Warnung und fällt auf den
 *  Default-Type-Renderer zurück.
 *
 *  `name` ist optional damit Caller den Hook unkonditional aufrufen
 *  können — Rules-of-Hooks verbieten einen Function-Branch der den Hook
 *  überspringt. So bleibt der Aufruf eine einzige Zeile, ohne dass der
 *  Caller einen Stub-Key wie `""` reichen muss. */
export function useColumnRenderer(name?: string): ColumnRendererComponent | undefined {
  const map = useContext(ColumnRenderersContext);
  if (name === undefined || name === "") return undefined;
  if (map === undefined) return undefined;
  return map[name];
}
