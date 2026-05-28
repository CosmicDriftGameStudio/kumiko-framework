// Extension-Section-Components-Map: client-side Lookup für entityEdit
// sections vom Type `extension`. RenderEdit schaut hier nach dem
// `__component`-Namen aus section.component und mountet die passende
// Component mit { entityName, entityId } — die Bundled-Feature-Component
// lädt + persistiert dann ihre eigenen Daten (z.B. custom-fields).
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
 *  Placeholder-Banner. */
export function useExtensionSectionComponent(name: string): ExtensionSectionComponent | undefined {
  const map = useContext(ExtensionSectionsContext);
  if (map === undefined) return undefined;
  return map[name];
}
