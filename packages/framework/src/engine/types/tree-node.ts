// TreeNode — single Knoten im Visual-Tree (opt-in Workspace mit
// `navigation: "tree"`). Provider liefern entweder statische
// readonly TreeNode[] oder dynamische TreeChildrenSubscribe.
//
// **Mental-Modell** (VS-Code-Explorer):
//   [icon] [label] [...hover-actions]
// optional ein target zum Klicken (öffnet Editor-Maske via
// Target-Resolver) und optional children als nested tree.
//
// **State** markiert Visual-Modus für Skeleton-Pattern:
//   - "filled" (default) — schwarz, Knoten hat Inhalt
//   - "stub" — hellgrau, existing aber leer (Designer-Stub-File)
//   - "empty" — Platzhalter für "+ create"-Affordance
//   - "loading" — Children werden gerade aufgelöst
//   - "error" — Provider hat Fehler emittiert
// Provider die kein Skeleton-Pattern brauchen müssen state nicht setzen.
//
// **Subscribe-Form** für dynamic Children: Provider erhält emit(),
// gibt unsubscribe() zurück. Initial-Emit synchron oder async, weitere
// Emits beliebig oft (z.B. wenn Entity-Row neu erscheint via SSE).
// Spielt natürlich mit existing SSE-Frame: ein Provider kann intern
// auf Entity-Update-Events abonnieren und bei Änderung emit() aufrufen.
//
// Siehe docs/plans/architecture/visual-tree.md A4.

import type { TargetRef } from "./target-ref";

export type TreeNodeState = "filled" | "stub" | "empty" | "loading" | "error";

export type TreeAction = {
  // Icon-Key — vom Renderer-Icon-Registry interpretiert. Konvention
  // matched NavDefinition.icon: unbekannte Icons surface als missing-icon
  // im UI, nicht als Boot-Failure.
  readonly icon: string;
  // i18n-Translation-Key oder roher String. Vom Renderer aufgelöst, Engine
  // behandelt opak (mirrors NavDefinition.label, WorkspaceDefinition.label).
  readonly label: string;
  // Klick-Ziel der Action. Pflicht — Action ohne target ist semantisch
  // sinnlos (Hover-Icon das nichts tut).
  readonly target: TargetRef;
};

export type TreeNode = {
  // i18n-Translation-Key oder roher String. Vom Renderer beim Rendern
  // aufgelöst (siehe TreeAction.label).
  readonly label: string;
  // Optional. Icon links neben dem Label. Selbe Konvention wie
  // TreeAction.icon — Renderer-Icon-Registry-Lookup.
  readonly icon?: string;
  // Visueller State für Skeleton-Pattern. Default "filled" (kein Eintrag
  // ⇒ schwarz/normal). Wert-Semantik im Header-Comment dieser Datei.
  readonly state?: TreeNodeState;
  // Optional Klick-Ziel. Fehlt → reiner Container-Knoten (nur ausklappbar,
  // nicht klickbar). Vorhanden → Klick öffnet die Editor-Maske via
  // Target-Resolver in renderer-web.
  readonly target?: TargetRef;
  // Hover-Actions rechts (Add/Refresh/Delete/etc.). Werden in der
  // Sidebar-Row erst bei Hover sichtbar — VS-Code-Pattern. Engine
  // ordnet die Actions in der Reihenfolge an, in der sie hier stehen.
  readonly actions?: readonly TreeAction[];
  // Statische Children oder dynamic Subscribe-Function. Subscribe wird
  // erst beim Ausklappen aufgerufen (lazy); die Function-Form erlaubt
  // SSE-gefütterte Live-Updates wenn neue Entity-Rows reinkommen.
  readonly children?: readonly TreeNode[] | TreeChildrenSubscribe;
};

// Subscribe<T> — Provider implementiert: emit(initial); ...emit(updated);
// und gibt unsubscribe-Function zurück. Caller (Tree-Component) ruft
// unsubscribe auf wenn Knoten unmounted/eingeklappt wird.
export type Subscribe<T> = (emit: (value: T) => void) => () => void;

// TreeChildrenSubscribe — Lazy-Variante für dynamic Children. Wird
// erst aufgerufen wenn der Knoten im UI ausgeklappt wird. ctx ist
// für Phase 0 ein opaque empty Type; V.1.1 erweitert ihn um Query-/
// Subscribe-Helpers (entity-list, slug-list etc.).
export type TreeChildrenSubscribe = (ctx: TreeContext) => Subscribe<readonly TreeNode[]>;

// TreeContext — Phase-0-Stub. Provider sollen ctx als opaque Handle
// behandeln — V.1.1-Erweiterungen sind non-breaking weil neue Felder
// nur additiv dazukommen.
export type TreeContext = Readonly<Record<string, never>>;
