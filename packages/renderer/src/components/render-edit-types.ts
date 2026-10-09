import type {
  ActionFormFooterAction,
  EntityDefinition,
  EntityEditScreenDefinition,
  IconKey,
  RowAction,
  RowActionDrawer,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type {
  DispatcherError,
  FormSnapshot,
  FormValues,
  SubmitResult,
  Translate,
} from "@cosmicdrift/kumiko-headless";
import type { ReactNode } from "react";
import type * as z from "zod";

export type RenderEditProps<TValues extends FormValues, TCtx = unknown> = {
  readonly screen: EntityEditScreenDefinition;
  /** Screen id used for the `screen:<id>.title`/`.subtitle` lookups and as the
   *  title fallback, when `screen.id` is synthetic (e.g. a secretMint confirm
   *  form keeps its own id for the draft key). Defaults to `screen.id`. */
  readonly i18nScreenId?: string;
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
  /** `values` are the form values at the moment the submit succeeded. */
  readonly onSubmit?: (result: SubmitResult<unknown>, values: TValues) => void;
  readonly payloadMode?: "values" | "changes";
  readonly buildPayload?: (snapshot: FormSnapshot<TValues>) => unknown;
  /** Prefix to strip from server validation issue paths before mapping them
   *  onto form fields — see SubmitConfig.serverFieldPathPrefix. Only needed
   *  when buildPayload nests the form values under a key. */
  readonly serverFieldPathPrefix?: string;
  /** Returning the rejected write's error shows it in the form-error banner;
   *  returning nothing means the delete went through. */
  // biome-ignore lint/suspicious/noConfusingVoidType: existing `() => void` callbacks must stay assignable
  readonly onDelete?: () => Promise<DispatcherError | void> | DispatcherError | void;
  readonly onCancel?: () => void;
  readonly onReload?: () => void;
  /** Fires when the form gains or loses unsaved input (field changes or a
   *  dirty extension section). Lets a host such as a drawer guard closing. */
  readonly onDirtyChange?: (dirty: boolean) => void;
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
  /** Opens a relatedList section row's drawer-kind action (fw#2710).
   *  RenderEdit has no `schema` to resolve the target actionForm itself —
   *  the caller (ProjectionDetailBody, which does have schema) supplies the
   *  opener and owns the actual Drawer state/rendering. Only projectionDetail
   *  passes this — the boot validator rejects relatedList sections on every
   *  other screen type that shares this layout. */
  readonly onRelatedListDrawerAction?: (
    action: RowActionDrawer,
    initialValues: Readonly<Record<string, unknown>> | undefined,
  ) => void;
  /** i18n key for the submit button. Default: "kumiko.actions.save".
   *  Action forms (tier 2.7d) pass their screen.submitLabel here so that
   *  "Save" can be replaced by domain-specific strings ("Approve" /
   *  "Dispatch" / etc.). */
  readonly submitLabel?: string;
  /** Set by submitPrefilled screens: defined shows the submit button even when no field is
   *  editable (all hidden or read-only); `true` also enables it while the form is unchanged. */
  readonly submitWithoutChanges?: boolean;
  /** Visual style of the submit button (actionForm `submitStyle`). Default "primary". */
  readonly submitVariant?: "primary" | "danger";
  /** Extra footer buttons (actionForm `footerActions`): each sets its `patch`
   *  on the form values, then submits through the normal validate + write path. */
  readonly footerActions?: readonly ActionFormFooterAction[];
  /** Context box above the drawer form (title + optional subtitle, already resolved). */
  readonly summary?: { readonly title: string; readonly subtitle?: string };
  /** Per-field extra content inline after the label (e.g.
   *  ConfigSourceBadge). Called with the field name, returns a ReactNode or
   *  undefined. */
  readonly labelAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Per-field extra content below the input (e.g. ConfigCascadeView).
   *  Called with the field name, returns a ReactNode or undefined. */
  readonly fieldAppendix?: (fieldName: string) => ReactNode | undefined;
  /** Placement of every `fieldAppendix` relative to its control. Default
   *  above-control; below-control keeps the inputs of neighbouring fields
   *  on one line when an appendix expands. */
  readonly fieldAppendixPlacement?: "above-control" | "below-control";
  /** Per-field help text rendered under the label (translated by the caller). */
  readonly fieldDescription?: (fieldName: string) => ReactNode | undefined;
  /** Marks fields whose value is set at this level; drawn by `settings-list` rows. */
  readonly fieldAccent?: (fieldName: string) => boolean;
  /** Edit-mode "changed" markers also for screens without an entity id
   *  (configEdit loads its values from a query, not a record). */
  readonly markChangedFields?: boolean;
  /** Controlled mode (issue #1887): fires on every values-snapshot change
   *  (typing, `patch(...)` from outside) with the current values. `changes`
   *  is the delta against the initial values — same semantics as
   *  `payloadMode: "changes"` — so a caller never overwrites unseen fields.
   *  `valid` is a pure dry-run parse against `schema` (not a
   *  `controller.validate()` call) that ignores issues on hidden fields and
   *  outside the `fields` scope, like submit() does, so it does not paint field errors into
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
   *  Section title) AND the form's own top-level title/subtitle — for a host
   *  that already renders that label itself elsewhere (e.g. a tab strip
   *  whose label duplicates it, or a page-level header above RenderEdit).
   *  Without this, the form's title (`screen:<id>.title` / `screen.id`)
   *  renders unconditionally regardless of section-level suppression — a
   *  host relying on this prop to fully own the heading otherwise sees a
   *  redundant title above its content. Omitting this prop keeps unchanged
   *  behavior. */
  readonly hideSectionTitles?: boolean;
  /** Screen body fills the shell height: the form gets `fillHeight` and
   *  `stickyActions` (sections scroll, footer pinned). Set by KumikoScreen for
   *  screens with `fillHeight !== false`; dialogs and other embedded hosts
   *  omit it and keep document-flow height. */
  readonly fillScreenHeight?: boolean;
  /** Rendered first inside the form, above the sections, in the same column and
   *  rhythm — for content that belongs to the form but is no field (e.g. the
   *  secret a confirm step refers to). */
  readonly leadContent?: ReactNode;
  /** Show the unsaved-changes footer (count, Discard, "Save changes") even
   *  without an entity id or a screen-height form — for hosts that edit an
   *  existing server-side record through `customSubmit` (configEdit, also when
   *  embedded as a dashboard panel). */
  readonly dirtyFooter?: boolean;
  /** Validate the edited field right after each change instead of only on
   *  submit, so a bounds violation shows at the field while the Save button
   *  looks enabled. Set where Save never blocks on a pre-check (configEdit). */
  readonly validateOnChange?: boolean;
  /** Extra content rendered above the card, sharing its left padding and
   *  width — for a host with its own header region (title/metrics/tabs)
   *  that would otherwise render as unpadded siblings before RenderEdit.
   *  Omitting this prop keeps unchanged behavior. */
  readonly headerRegion?: ReactNode | ((headerSlot: ReactNode | undefined) => ReactNode);
  /** resolves an `EditFieldsSection`/`EditExtensionSection`/
   *  `EditRelatedListSection`/`EditWriteFormSection`'s own `actions` into
   *  already-bound buttons, rendered in that section's title row — same
   *  split as `onCopyLink`/header `actions`: RenderEdit has no dispatcher/nav
   *  context of its own, so the caller (which does) resolves each RowAction
   *  against the record being edited. Returns `undefined`/`[]` to render no
   *  actions for that section. */
  readonly buildSectionActions?: (
    actions: readonly RowAction[],
  ) => readonly RenderEditAction[] | undefined;
};

export type RenderEditAction = {
  readonly id: string;
  readonly label: string;
  readonly onPress: () => void | Promise<void>;
  readonly style?: "primary" | "secondary" | "danger";
  readonly confirm?: string;
  readonly confirmLabel?: string;
  /** Overrides the default "danger implies a confirm dialog" rule. Schema-driven
   *  navigate/drawer actions set it to false: the colour marks the action as
   *  destructive, but the target form is the confirmation. */
  readonly confirmRequired?: boolean;
  /** Resolved icon (author `RowAction.icon` or the id-derived default) —
   *  drives both the icon-left-of-text render and the icon-only collapse
   *  rule (see `shouldRenderActionsIconOnly`). */
  readonly icon?: IconKey;
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
  /** Wizard only (no-op elsewhere): validates the current step and advances,
   *  like the built-in Next button. A `hideActions` host steps with this. */
  readonly next: () => void;
  /** Wizard only (no-op elsewhere): goes back one step without validating. */
  readonly back: () => void;
};
