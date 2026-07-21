// TreeNode — single Knoten im Client-navProvider-Tree. Provider liefern
// entweder statische readonly TreeNode[] oder dynamische TreeChildrenSubscribe.
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
  // Provider-deklarierte „+ create"-Action für Knoten mit `state: "empty"`.
  // Tree-Component zeigt automatisch ein „+"-Icon und dispatcht
  // `createAction.target` bei Klick — Provider weiß was „leer befüllen"
  // für ihn bedeutet (z.B. „neuer Page-Slug" vs „neue Entity-Row"),
  // Convention könnte das nicht raten. Konsistent zu `state` (auch
  // Provider-explizit). Siehe visual-tree.md V.1.1-Decision D3.
  readonly createAction?: TreeAction;
};

// Subscribe<T> — Provider implementiert: emit(initial); ...emit(updated);
// und gibt unsubscribe-Function zurück. Caller (Tree-Component) ruft
// unsubscribe auf wenn Knoten unmounted/eingeklappt wird.
//
// **V.1.4 emitError**: optional callback für async-error-Pfade (fetch-
// fail, SSE-disconnect). Provider die explizit Errors signalisieren
// wollen rufen `emitError(e)` statt empty-emit; VisualTree zeigt
// Error-Banner mit Retry-Button. Sync-Throws im Provider-Body werden
// vom useEffect-try/catch abgefangen — emitError ist nur für async.
export type Subscribe<T> = (
  emit: (value: T) => void,
  emitError?: (error: Error) => void,
) => () => void;

// TreeChildrenSubscribe — Lazy-Variante für dynamic Children. Wird
// erst aufgerufen wenn der Knoten im UI ausgeklappt wird. Kein ctx-
// Argument: Provider sind session-bound; Backend liest tenantId aus
// session bei jedem fetch/dispatch. V.1.1 hatte ein ctx mit tenantId,
// das aber im Browser nie echten Tenant trug (war auf SYSTEM_TENANT_ID
// gepinnt) und vom einzigen V.1.2-Consumer (text-content) ignoriert
// wurde. SR2-Rip 2026-05-18: Dead-API entfernt; wenn später ein
// Provider tenant-aware-rendern muss (z.B. cross-tenant-Dashboards
// für SystemAdmin), wird ctx mit echtem Tenant-Source aus dem Auth-
// Layer re-introduziert. YAGNI bis dahin.
export type TreeChildrenSubscribe = () => Subscribe<readonly TreeNode[]>;

// TreeActionDef — Schema-Eintrag pro Action in der treeActions-Map
// eines Features. Phase 0: Args sind ein optionales Type-Sample
// (kein Validator zur Laufzeit — Validation passiert compile-time
// via buildTarget-Generic, runtime via Editor-Panel-Schema).
//
// Lebt hier (nicht in build-target.ts) weil es konzeptuell zur
// Visual-Tree-Domäne gehört, nicht zum Builder. build-target.ts
// importiert den Type von hier.
export type TreeActionDef<TArgs = Record<string, unknown>> = {
  readonly args?: TArgs;
};

// TreeActionsHandle<T> — Return-Type von r.treeActions(...). Trägt
// den literal-typed Action-Map durch das Feature-Export-System
// (siehe FeatureDefinition.exports + Memory `[EventDef-Exports-
// Pattern]`). Das ist die compile-time Bridge zu buildTarget:
//
//   const handle = r.treeActions({ edit: { args: { slug: "" as string } } });
//   // handle.id        → TFeature (literal feature name)
//   // handle.treeActions → { edit: { args: { slug: string } } } (literal-typed)
//   buildTarget({ target: handle, action: "edit", args: { slug: "x" } });
//   //                                ^^^^^^^^^^^^^^         ^^^^^^^^
//   //                                literal-validated      typed-validated
//
// Runtime-Lookup geht über FeatureDefinition.treeActions (erased Map),
// Compile-Time-Validation über diesen Handle.
export type TreeActionsHandle<
  TFeature extends string,
  TActions extends Record<string, TreeActionDef>,
> = {
  readonly id: TFeature;
  readonly treeActions: TActions;
};
