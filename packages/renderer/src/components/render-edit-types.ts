import type { z } from "zod";
import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";

export type RenderEditProps<TValues extends FormValues, TCtx = unknown> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly featureName: string;
  readonly initial: TValues;
  /** Echte entity-id für extension-section-Mounts (Set-Value-UI). Mount UND
   *  persistExtensions lösen sie über `resolveExtensionEntityId(entityIdProp,
   *  vm.id)` auf — denselben Wert, damit die Section nicht editierbar gegen eine
   *  id mountet während Persist gegen eine andere (oder gar nicht) schreibt.
   *  Weglassen (undefined) = Fallback auf `vm.id` (= values["id"]), das das
   *  Update-Form für die bestehende Row trägt. Explizites `null` = "keine
   *  entity" (create-mode / keine extension-Persistenz). */
  readonly entityId?: string | null;
  /** Bereits gespeicherte Extension-Werte (z.B. `record.customFields`) für
   *  extension-section-Mounts. Erlaubt der Section, den Bestand beim Edit
   *  anzuzeigen. Nur der Update-Body liefert das. */
  readonly extensionInitialValues?: Readonly<Record<string, unknown>>;
  /** Standard single-write Submit-Pfad. Ignoriert wenn `customSubmit`
   *  gesetzt ist (configEdit-Screens dispatchen mehrere Writes pro
   *  Submit, da macht writeCommand keinen Sinn). */
  readonly writeCommand?: string;
  /** Override für die Submit-Pipeline. Wenn gesetzt, läuft erst
   *  controller.validate() und dann customSubmit(snapshot) statt
   *  controller.submit(). On-success rebased der Form-State so dass
   *  isUnchanged/isDirty wieder false werden — ohne das blieben
   *  Save-Button und Banner stale. */
  readonly customSubmit?: (snapshot: FormSnapshot<TValues>) => Promise<SubmitResult<unknown>>;
  readonly translate?: Translate;
  readonly ctx?: TCtx;
  readonly schema?: z.ZodType;
  readonly onSubmit?: (result: SubmitResult<unknown>) => void;
  readonly payloadMode?: "values" | "changes";
  readonly buildPayload?: (snapshot: FormSnapshot<TValues>) => unknown;
  readonly onDelete?: () => Promise<void> | void;
  readonly onCancel?: () => void;
  readonly onReload?: () => void;
  /** Copy-Link-Action (Issue #912) — nur in update-mode gesetzt (create-mode
   *  hat noch keine entity-id, also keinen Permalink). Der Callback ist
   *  bereits vollständig gebunden (URL-Bau + Clipboard passiert außerhalb,
   *  in `@cosmicdrift/kumiko-renderer-web`'s RoutedScreen — dieses
   *  platform-neutrale Package darf kein `navigator`/`window` anfassen,
   *  siehe guard-renderer-boundaries). undefined = kein Button. */
  readonly onCopyLink?: () => Promise<void> | void;
  /** Header action buttons, rendered before the built-in copy-link/
   *  delete/cancel/save controls. Each callback is already fully
   *  bound (screen-type/nav/dispatcher resolution happens in the caller,
   *  same split as `onCopyLink`) — RenderEdit only wires the button, its
   *  busy state and its confirm dialog. */
  readonly actions?: readonly RenderEditAction[];
  /** i18n-key für den Submit-Button. Default: "kumiko.actions.save".
   *  Action-Forms (Tier 2.7d) übergeben hier ihren screen.submitLabel,
   *  damit "Speichern" durch domain-spezifischere Strings ersetzt
   *  werden kann ("Genehmigen" / "Versenden" / etc.). */
  readonly submitLabel?: string;
  /** Pro-Field-Zusatz-Inhalt inline nach dem Label (z.B. ConfigSourceBadge).
   *  Wird mit dem Field-Namen aufgerufen, returnt ReactNode oder
   *  undefined. */
  readonly labelAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Pro-Field-Zusatz-Inhalt unter dem Input (z.B. ConfigCascadeView).
   *  Wird mit dem Field-Namen aufgerufen, returnt ReactNode oder
   *  undefined. */
  readonly fieldAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Controlled mode (issue #1887): fires on every values-snapshot change
   *  (typing, `patch(...)` from outside) with the current values. `changes`
   *  is the delta against the initial values — same semantics as
   *  `payloadMode: "changes"` — so a caller never overwrites unseen fields.
   *  `valid` is a pure dry-run parse against `schema` (not a
   *  `controller.validate()` call), so it does not paint field errors into
   *  the UI and can diverge from the currently rendered `snapshot.errors` —
   *  always `true` without `schema`. A caller that patches a fresh object
   *  reference on every call must not do so unconditionally: `setValues` is
   *  a no-op when the merged value is reference-equal to the current one,
   *  so only a converging patch settles instead of looping. Without this
   *  prop, existing behavior is unchanged. `onControlsReady` is guaranteed
   *  to have already fired by the time the mount-time `onChange` call
   *  happens, so a caller patching dependent fields from inside `onChange`
   *  never has to guard against `controls` being undefined. */
  readonly onChange?: (state: RenderEditChangeState<TValues>) => void;
  /** Controlled mode (issue #1887): called once after mount, hands the
   *  caller `patch`/`validate`/`getValues` bound to this RenderEdit
   *  instance — addressable from outside without a remount. `patch` merges
   *  only the given keys (existing `controller.setValues` semantics),
   *  values on unmentioned fields stay untouched. `validate` runs without a
   *  write and reports field issues via `snapshot.errors` on the field
   *  itself rather than as a summary banner. Without this prop, existing
   *  behavior is unchanged. */
  readonly onControlsReady?: (controls: RenderEditControls<TValues>) => void;
  /** Renders only these fields (by `field` name from the layout) — section
   *  order, title, and visibility still come from the layout, so the caller
   *  doesn't duplicate its shape. A section with no fields left after
   *  filtering is dropped entirely (not rendered empty). Submit validation
   *  is scoped to the actually-rendered fields the same way — a required
   *  field outside this list doesn't block submit. Omitting this prop keeps
   *  unchanged behavior. Read once at mount for `controller.submit()`'s
   *  validation scope (the underlying `useForm` controller is mount-lived);
   *  rendering and `controls.validate()` do stay reactive to later changes. */
  readonly fields?: readonly string[];
  /** Locked state (issue #1896): every rendered field and the submit button
   *  go visibly inactive, no write possible. For cases where input becomes
   *  moot — e.g. Solon's editor pointing at an existing record instead of
   *  creating a new one. Extension sections are out of scope: RenderEdit has
   *  no way to force-disable an arbitrary registered component. Omitting
   *  this prop keeps unchanged behavior.
   *
   *  ponytail: direct-consumer only — kumiko-screen.tsx's RenderEdit call
   *  sites pass explicit prop lists without a spread and never forward
   *  `disabled`, so a screen-driven app can't set the locked state today.
   *  Upgrade path if that's needed: thread a screen-spec flag through to
   *  `EntityEditCreateBody`/`EntityEditEditBody`. */
  readonly disabled?: boolean;
  /** Renders the fields without RenderEdit's own action bar (save, cancel,
   *  delete, copy-link). For hosts that put those controls into their own
   *  chrome — a drawer footer, a wizard shell — and drive the write through
   *  `onControlsReady`'s `submit`. Omitting this prop keeps unchanged
   *  behavior. */
  readonly hideActions?: boolean;
  /** "form" (default) — every field renders as its Input widget, disabled
   *  when `field.readOnly`, unchanged behavior. "text" renders a
   *  `field.readOnly` field as plain text instead of a disabled Input
   *  (ProjectionDetailBody's read view, fw#2245) — editable fields are
   *  unaffected either way, so this only changes forms that already have
   *  readOnly fields. */
  readonly valueDisplay?: "form" | "text";
};

export type RenderEditAction = {
  readonly id: string;
  readonly label: string;
  readonly onPress: () => void | Promise<void>;
  readonly style?: "primary" | "secondary" | "danger";
  readonly confirm?: string;
  readonly confirmLabel?: string;
};

export type RenderEditChangeState<TValues extends FormValues> = {
  readonly values: TValues;
  readonly changes: Partial<TValues>;
  readonly dirty: boolean;
  readonly valid: boolean;
  readonly submitting: boolean;
};

export type RenderEditControls<TValues extends FormValues> = {
  readonly patch: (partial: Partial<TValues>) => void;
  readonly validate: () => boolean;
  readonly getValues: () => TValues;
  /** Runs the same pipeline the built-in save button runs: validation,
   *  `customSubmit`/`writeCommand`, extension-section persistence, draft
   *  discard, state rebase. Unlike the button it carries no unchanged-form
   *  guard — a host showing a pre-filled proposal must be able to accept it
   *  untouched. */
  readonly submit: () => Promise<void>;
};
