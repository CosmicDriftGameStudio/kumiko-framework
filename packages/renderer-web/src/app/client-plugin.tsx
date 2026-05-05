// Plugin-Shape für feature-gelieferte Client-Extensions. Server-Features
// (defineFeature) registrieren Handler, Projections, Hooks; Client-
// Features registrieren Context-Provider und Gate-Wrapper. createKumikoApp
// stackt sie in einer definierten Reihenfolge in den React-Tree.
//
// Warum die Zweiteilung (providers/gates)? Damit Features, die selbst
// einen Gate brauchen (z.B. AuthGate → LoginScreen), trotzdem den
// Context anderer Features anzapfen können: erst werden alle Provider
// ganz außen gestackt, dann alle Gates nach innen. So hat jeder Gate
// Zugriff auf jeden Provider, egal welches Feature ihn gebracht hat.

import type { ColumnRendererComponent, TranslationsByLocale } from "@cosmicdrift/kumiko-renderer";
import type { ComponentType, ReactNode } from "react";

export type ClientFeatureDefinition = {
  readonly name: string;
  /** Context-Provider die um den kompletten Renderer-Tree gewrapped
   *  werden. Reihenfolge: erstes Element = äußerster Provider. Alle
   *  Provider stehen VOR allen Gates im Baum, damit jeder Gate und
   *  jedes Screen-Child darauf Zugriff hat. */
  readonly providers?: readonly ComponentType<{ children: ReactNode }>[];
  /** Screen-Decorators die zwischen dem Provider-Stack und dem Shell/
   *  Screen-Render sitzen. Typisches Muster: AuthGate rendert den
   *  LoginScreen statt children solange der User nicht eingeloggt ist.
   *  Reihenfolge: erstes Element = äußerster Gate. */
  readonly gates?: readonly ComponentType<{ children: ReactNode }>[];
  /** Default-Translations die das Feature für seine UI-Strings
   *  mitbringt. Werden in den LocaleProvider als Fallback-Bundle
   *  eingehängt — der App-Resolver (z.B. i18next) hat Vorrang und kann
   *  einzelne Keys überschreiben, ohne dass die Feature-Bundles
   *  komplett ausgetauscht werden müssen. */
  readonly translations?: TranslationsByLocale;
  /** Custom-Screen-Components — Map screenId → React-Component. Wenn
   *  ein Schema-Screen `type: "custom"` hat, schaut KumikoScreen in
   *  diese Map (gemerged aus allen ClientFeatures) und rendert die
   *  passende Component. So muss kein Sample mehr im AppShell-Wrapper
   *  selbst routen. Convention: screenId entspricht dem `id` aus
   *  `r.screen({ id, type: "custom", ... })` im server-side Feature. */
  readonly components?: Readonly<Record<string, ComponentType>>;
  /** Column-Renderer-Components — Map renderer-name → React-Component.
   *  Schema deklariert eine Column mit
   *  `renderer: { react: { __component: "ColorSwatch" } }`; client-side
   *  zieht der DataTable-Cell-Renderer den Component hier raus.
   *  Schemas bleiben so serializable (nur ein String-Key auf der Wire),
   *  echte JSX-Renderer leben im Client-Bundle. Last-Wins bei Key-
   *  Kollision über mehrere Features. */
  readonly columnRenderers?: Readonly<Record<string, ColumnRendererComponent>>;
};

/** Wickelt einen ReactNode durch eine Liste von Providern/Gates von
 *  innen nach außen — erstes Array-Element ist äußerste Hülle.
 *  Der Key nutzt den Component-Display-Namen (falls gesetzt) plus
 *  Index, damit Mounts stabil bleiben solange die Wrapper-Liste
 *  ihre Reihenfolge nicht ändert. */
export function stackWrappers(
  wrappers: readonly ComponentType<{ children: ReactNode }>[],
  inner: ReactNode,
): ReactNode {
  return wrappers.reduceRight<ReactNode>((acc, Wrapper, i) => {
    const key = `${Wrapper.displayName ?? Wrapper.name ?? "wrapper"}-${i}`;
    return <Wrapper key={key}>{acc}</Wrapper>;
  }, inner);
}
