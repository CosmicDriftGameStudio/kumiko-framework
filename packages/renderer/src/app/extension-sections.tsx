// Extension-Section-Components-Map: client-side Lookup für entityEdit
// sections vom Type `extension`, List-Header-Slots UND Dashboard-`custom`-
// Panels. Jeder Mount-Ort löst den `__component`-Namen aus einer
// PlatformComponent über dieselbe Registry auf und mountet die passende
// Component — die Bundled-Feature-/App-Component lädt + persistiert dann
// ihre eigenen Daten (z.B. custom-fields, oder ein eigenständiger Chart).
//
// Mounting analog zu CustomScreensProvider — createKumikoApp im
// renderer-web sammelt alle clientFeatures.extensionSectionComponents und
// mountet den Provider; Tests die einzelne Sections prüfen wollen
// mounten den Provider direkt.

import type { PlatformComponent } from "@cosmicdrift/kumiko-framework/ui-types";
import { type ComponentType, createContext, type ReactNode, useContext } from "react";

/** Extrahiert den `__component`-Namen aus einer PlatformComponent. Liest
 *  react- und native-Branch (die App-Author registriert beide unter dem
 *  gleichen Namen); returnt den ersten gefundenen string. Pure narrowing
 *  via `in` — kein cast, kein assertion. */
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
  /** Bereits gespeicherte Extension-Werte der Entity (aus der geladenen
   *  detail-row durchgereicht). `undefined` im Create-Mode oder wenn der
   *  Host-Screen keine Werte liefert. Erlaubt der Section, den Bestand
   *  beim Edit anzuzeigen statt write-only zu sein. */
  readonly initialValues?: Readonly<Record<string, unknown>>;
  /** Nur im List-Header-Slot gesetzt (entityId ist dort null): die screen.id
   *  der Liste, damit ein Header-Control den per-Screen URL-Filter-State
   *  (useListUrlState) ansprechen kann — z.B. ein Tag-Filter der die Liste auf
   *  eine id-Menge narrowed. In entityEdit-Sections undefined. */
  readonly screenId?: string;
  /** Nur im Dashboard-`custom`-Panel gesetzt: der aktuell gewählte Wert des
   *  Screen-Filters (siehe DashboardFilterDefinition), gemerged wie bei jeder
   *  anderen Panel-Query. In allen anderen Mount-Orten undefined. Dashboard-
   *  Panels haben keine Entity — entityName/entityId tragen dort die
   *  screen.id bzw. null, siehe CustomPanelBody in dashboard-body.tsx. */
  readonly filterParams?: Readonly<Record<string, unknown>>;
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

/** Schaut die Component für einen extension-section-Namen nach. Returnt
 *  undefined wenn weder Provider gemounted noch der Name in der Map
 *  registriert ist — der Caller (RenderEdit) zeigt dann seinen
 *  Placeholder-Banner. `name` ist optional damit Caller den Hook
 *  unkonditional aufrufen können (Rules-of-Hooks), ohne einen Stub-Key
 *  wie `""` reichen zu müssen — analog `useColumnRenderer`. */
export function useExtensionSectionComponent(name?: string): ExtensionSectionComponent | undefined {
  const map = useContext(ExtensionSectionsContext);
  if (name === undefined || name === "") return undefined;
  if (map === undefined) return undefined;
  return map[name];
}
