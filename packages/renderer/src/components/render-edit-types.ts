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
import type { z } from "zod";

export type RenderEditProps<TValues extends FormValues, TCtx = unknown> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly featureName: string;
  readonly initial: TValues;
  /** Real entity id for extension-section mounts (set-value UI). Mount AND
   *  persistExtensions resolve it via `resolveExtensionEntityId(entityIdProp,
   *  vm.id)` — the same value, so the section doesn't mount editable against
   *  one id while persist writes against another (or none at all).
   *  Omitting (undefined) = fallback to `vm.id` (= values["id"]), which the
   *  update form carries for the existing row. Explicit `null` = "no entity"
   *  (create mode / no extension persistence). */
  readonly entityId?: string | null;
  /** Already-persisted extension values (e.g. `record.customFields`) for
   *  extension-section mounts. Lets the section display its current stock
   *  during edit. Only the update body provides this. */
  readonly extensionInitialValues?: Readonly<Record<string, unknown>>;
  /** Standard single-write submit path. Ignored when `customSubmit` is set
   *  (configEdit screens dispatch multiple writes per submit, where a single
   *  writeCommand makes no sense). */
  readonly writeCommand?: string;
  /** Override for the submit pipeline. When set, runs controller.validate()
   *  and then customSubmit(snapshot) instead of controller.submit(). On
   *  success the form state rebases so that isUnchanged/isDirty become false
   *  again — without that, save button and banner stay stale. */
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
  /** Copy-link action (issue #912) — only set in update mode (create mode
   *  has no entity id yet, hence no permalink). The callback is already fully
   *  bound (URL building + clipboard happen outside, in
   *  `@cosmicdrift/kumiko-renderer-web`'s RoutedScreen — this platform-neutral
   *  package must not touch `navigator`/`window`, see
   *  guard-renderer-boundaries). undefined = no button. */
  readonly onCopyLink?: () => Promise<void> | void;
  /** Header action buttons, rendered before the built-in copy-link/
   *  delete/cancel/save controls. Each callback is already fully
   *  bound (screen-type/nav/dispatcher resolution happens in the caller,
   *  same split as `onCopyLink`) — RenderEdit only wires the button, its
   *  busy state and its confirm dialog. */
  readonly actions?: readonly RenderEditAction[];
  /** i18n key for the submit button. Default: "kumiko.actions.save".
   *  Action forms (tier 2.7d) pass their screen.submitLabel here so that
   *  "Save" can be replaced by domain-specific strings ("Approve" /
   *  "Dispatch" / etc.). */
  readonly submitLabel?: string;
  /** Per-field extra content inline after the label (e.g.
   *  ConfigSourceBadge). Called with the field name, returns a ReactNode or
   *  undefined. */
  readonly labelAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Per-field extra content below the input (e.g. ConfigCascadeView).
   *  Called with the field name, returns a ReactNode or undefined. */
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
  /** Suppresses every section's own title (fields-section header, relatedList
   *  Section title) — for a host that already renders the section label
   *  itself elsewhere (e.g. a tab strip whose label duplicates it).
   *  Omitting this prop keeps unchanged behavior. */
  readonly hideSectionTitles?: boolean;
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
