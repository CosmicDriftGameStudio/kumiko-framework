import type { FormFieldDefinition } from "./fields.ts";
import type { AccessRule, AgentScreenHints } from "./handlers.ts";
import type { IconKey } from "./nav-icon.ts";
import type { ScreenNavSugar, ScreenSlots } from "./screen.ts";
import type { DashboardPanelVisibility } from "./screen-dashboard.ts";
import type { EditLayout } from "./screen-entity-edit.ts";

// --- actionForm ---

// Form screen for non-CRUD write handlers. Rendered like an
// EntityEditScreen (sections + fields), but:
//   - no detail fetch on mount (initial state = field defaults)
//   - no CRUD verb mapping ("create"/"update") — the author names the
//     write handler QN explicitly
//   - the form object lands 1:1 as the handler's payload; its Zod schema
//     keeps validating
//   - optional `redirect` to another screen after submit success
//
// Examples: "Send invitation" (with recipient email + role), "Approve
// invoice" (with notes), "Bulk import" (with CSV string + mode).
//
// Field shape: inline on the screen instead of an entity reference. The
// author controls what the form renders without creating a whole entity
// for it. The FieldDefinitions are the same as on entities
// (text/select/number/...) — all DefaultInput renderers apply unchanged.
/** A form field computed from other fields of the same form. `listSum` adds one
 *  numeric cell over all rows of an embedded list field; its `whenEmpty`
 *  fallback applies while the list has no rows (it must not be a `listSum`). */
export type FormFieldDerivation =
  | {
      readonly op: "sum" | "subtract" | "multiply" | "percent";
      readonly from: readonly string[];
    }
  | {
      readonly op: "listSum";
      readonly list: string;
      readonly cell: string;
      readonly whenEmpty?: FormFieldDerivationWithoutList;
    };

export type FormFieldDerivationWithoutList = Extract<FormFieldDerivation, { from: unknown }>;

export type ActionFormScreenDefinition = {
  readonly id: string;
  readonly type: "actionForm";
  /** Default true: the screen fills the shell content height, its body scrolls
   *  inside and the pager / action bar stays pinned. `false` restores page
   *  scroll (table grows with its rows, pager below the last row, form footer
   *  in the flow). */
  readonly fillHeight?: boolean;
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: DashboardPanelVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: string;
  /** Derived by buildAppSchema — see EntityEditScreenDefinition.urlPrefillFields. */
  readonly urlPrefillFields?: readonly string[];
  /** Derived by buildAppSchema from the `excludedFields` of the called `handler`; the form
   *  shows these fields read-only, not required and never in the payload. An authored value is overwritten. */
  readonly writeExcludedFields?: readonly string[];
  /** Submit is enabled without edits: values seeded from navigate `params` count as the
   *  user's intent. Every required field the layout hides with `visible: false` must hold a
   *  value, otherwise submit stays disabled (boot-checked against navigate `params`). */
  readonly submitPrefilled?: boolean;
  /** Write-handler QN called on submit. The form object lands 1:1 as the
   *  payload — the handler schema (Zod) keeps validating. */
  readonly handler: string;
  /** Form shape: field map by name. Uses the same FieldDefinitions as
   *  entity fields. At least one field is required (boot
   *  validator).
   *
   *  A `money` field here must name its own currency source: this screen
   *  has no entity whose `defaultCurrency` it could inherit. */
  readonly fields: Readonly<Record<string, FormFieldDefinition>>;
  /** Fields computed from other fields, shown read-only and recomputed on every
   *  change. A `listSum` over an empty list without `whenEmpty` leaves the field
   *  a normal input, and then the client value counts. Otherwise the client value
   *  is never trusted: the handler must wrap its schema with
   *  `withFormDerivations(schema, screen)`, which the boot validator enforces.
   *  A field read only as `whenEmpty` operand is read-only while every such list has rows. */
  readonly derive?: Readonly<Record<string, FormFieldDerivation>>;
  /** Layout analogous to EntityEditScreen: sections with fields from the
   *  fields map above. */
  readonly layout: EditLayout;
  /** Per-field label i18n key override, same type/semantics as
   *  `EntityEditScreenDefinition.fieldLabels`. Falls back to the convention when absent. */
  readonly fieldLabels?: Readonly<Record<string, string>>;
  /** i18n key for the submit button. Default: the renderer's i18n default
   *  (typically "actions.submit"). */
  readonly submitLabel?: string;
  /** Extra buttons in the form footer next to the submit button. A click
   *  applies `patch` to the form values, then submits the form (same
   *  validation, same handler) — e.g. a "Mark as posted" button that sets
   *  `posted: true`. The patched field need not be rendered by the layout.
   *  Order in the array = order in the footer, before the submit button. */
  readonly footerActions?: readonly ActionFormFooterAction[];
  /** Context box above the fields (i18n keys). `{name}` placeholders resolve from the
   *  drawer prefill (`params` of the opening row action), formatted for display. */
  readonly summary?: { readonly title: string; readonly subtitle?: string };
  /** Visual style of the submit button. "danger" renders it red — for a form
   *  whose handler is destructive (terminate, revoke, delete), so the warning
   *  isn't lost on the way from the calling screen to this one. Default "primary". */
  readonly submitStyle?: "primary" | "danger";
  /** i18n key of a confirmation shown above the form after a successful submit
   *  when the screen stays put (no `redirect`, not drawer-hosted). `{field}`
   *  placeholders resolve from the submitted values; a `reference` field shows
   *  the chosen record's label (its `labelField`), not the id — so a
   *  cross-tenant admin form can name the record it just changed. */
  readonly successMessage?: string;
  /** Navigate to this screen ID after a successful submit: either a short
   *  ID (e.g. "item-list" — same feature, the nav-router resolves to the
   *  full path) or a fully-qualified cross-feature QN
   *  (`<feature>:screen:<id>`). If not set, the user stays on the form
   *  screen. Boot-validator checks that the target resolves to a
   *  registered screen. A cross-feature QN hard-couples this feature to
   *  the target at boot time — an app that doesn't mount the target
   *  feature fails the boot-validator; only use this form in a reusable
   *  feature when the target feature is guaranteed to be mounted
   *  alongside it.
   *
   *  The object form additionally names the success-payload field the
   *  navigation id comes from (`ActionFormRedirect.idFrom`) — needed when
   *  the handler creates a child record but the target screen is the
   *  parent's detail screen. */
  readonly redirect?: string | ActionFormRedirect;
  /** Links shown in the success box after a successful submit while the
   *  screen stays put. Targets resolve like `redirect` (the id comes from the
   *  handler's success payload); a link without a string id is hidden.
   *  Mutually exclusive with `redirect`. */
  readonly successLinks?: readonly ActionFormSuccessLink[];
  /** Key figures from the handler's success payload, shown in the success box
   *  while the screen stays put (e.g. charged/skipped/failed of a batch run).
   *  Mutually exclusive with `redirect`. */
  readonly successFacts?: readonly ActionFormSuccessFact[];
  /** Reset the form to its initial values after a successful submit (prefill
   *  kept, typed values cleared). Only applies while the screen stays put,
   *  i.e. without `redirect`. */
  readonly resetOnSuccess?: boolean;
  /** Load the initial values from a query. The record id comes from the route
   *  (or the drawer row id) and is sent as `{ [idParam]: id }`; the result,
   *  picked to `fields`, becomes the initial values. Turns URL prefill off:
   *  search params never reach the form. */
  readonly load?: ActionFormLoad;
  /** Target of the Cancel button. Default: `redirect` (historical
   *  behavior — Cancel and the submit-redirect then land in the same
   *  place). `false` = no Cancel button; correct for single-action
   *  screens with no discardable state (e.g. "Send test mail"), where
   *  Cancel would just be a second path to the same target. Accepts the
   *  same string targets as `redirect` (short ID or cross-feature QN);
   *  boot-validator checks it. A cross-feature QN hard-couples this
   *  feature to the target at boot time — an app that doesn't mount the
   *  target feature fails the boot-validator; only use this form in a
   *  reusable feature when the target feature is guaranteed to be
   *  mounted alongside it. */
  readonly cancelTarget?: string | false;
  /** Parent list screen (short id) for breadcrumb + nav highlighting when
   *  this screen has no nav entry of its own. Same field/semantics as on
   *  `custom`/`projectionDetail`/`entityEdit`; an explicit value here wins
   *  over the rowAction heuristic. */
  readonly listScreenId?: string;
  readonly slots?: ScreenSlots;
  readonly access?: AccessRule;
};

export type ActionFormFooterAction = {
  /** Stable id (kebab-case), used for the test id. */
  readonly id: string;
  /** i18n key. */
  readonly label: string;
  readonly icon?: IconKey;
  /** Button style. Default "secondary". */
  readonly variant?: "primary" | "secondary" | "danger";
  /** Form values set before the submit. JSON-safe literals only. */
  readonly patch: Readonly<Record<string, string | number | boolean | null>>;
};

/** Redirect target plus the success-payload field carrying the navigation
 *  id. The write-handler reports the id of what it wrote (`data.id`); when
 *  that record is a child and the target screen shows its parent, the
 *  parent id has to be read from a different field instead of forcing the
 *  handler to misreport its own result. */
export type ActionFormRedirect = {
  /** Same target forms as the string `redirect`: short screen ID
   *  (same-feature) or a fully-qualified cross-feature screen QN. */
  readonly screen: string;
  /** Flat field name in the handler's success payload, e.g. "leaseId".
   *  Only used when the target screen type carries an id (`entityEdit`,
   *  `projectionDetail`); a non-string or missing value navigates without
   *  an id, same as a payload without `id` does today. */
  readonly idFrom: string;
  /** Section id to open on the target `projectionDetail` with `layout.mode:
   *  "tabs"` (the `tab` search param, same as `ToolbarAction` navigate `tab`).
   *  Boot rejects other targets and unknown section ids. */
  readonly tab?: string;
};

export type ActionFormLoad = {
  /** Query QN that returns the record. */
  readonly query: string;
  /** Payload key carrying the record id (default "id"). */
  readonly idParam?: string;
  /** The query picks the row from the caller's tenant/session context, so the
   *  form loads without a record id and the query is called WITHOUT `idParam`
   *  (same semantics as `ProjectionDetailScreenDefinition.singleton`). Boot
   *  rejects declaring `idParam` alongside it. */
  readonly singleton?: boolean;
};

/** One key figure of the success box, read from the handler's success payload. */
export type ActionFormSuccessFact = {
  /** Flat field name in the handler's success payload. A number or string is
   *  shown as one value, an array a comma-separated list (numbers, strings and
   *  `{ label }` objects). A missing field hides the fact. */
  readonly field: string;
  /** Label (i18n key). */
  readonly label: string;
};

/** A redirect target rendered as a link in the success box. */
export type ActionFormSuccessLink = Omit<ActionFormRedirect, "idFrom"> & {
  /** Success-payload field carrying the navigation id. Required for a record
   *  target (`entityEdit`, `projectionDetail`); omit it for a list, dashboard
   *  or form target, which opens without an id. */
  readonly idFrom?: string;
  /** Link text (i18n key). */
  readonly label: string;
};

/** Author-declared field shown once after a mint-form submit — API token,
 *  recovery codes, similar one-time secrets. */
export type SecretRevealField = {
  /** Flat field name in the handler's success payload. */
  readonly field: string;
  /** i18n key for this value's label. */
  readonly label: string;
  /** "code" (default) renders one monospaced value; "list" renders a
   *  string-array payload one value per line (recovery codes); "qr" renders
   *  the value as a scannable QR code (otpauth://-style enrollment URI) —
   *  platforms without a QR-capable SecretReveal primitive fall back to the
   *  monospaced text display. */
  readonly display?: "code" | "list" | "qr";
  /** Default true — offer a copy-to-clipboard control next to the value. */
  readonly copyable?: boolean;
};

/** Post-reveal proof-of-receipt step. A mint whose effect is only armed once
 *  the user proves they received the secret (TOTP enrollment: scan the code,
 *  then enter one) declares it here — the reveal card renders this form in
 *  place of the bare acknowledge button. */
export type SecretMintConfirmStep = {
  /** Write-handler QN dispatched when the confirm form is submitted. */
  readonly handler: string;
  readonly fields: Readonly<Record<string, FormFieldDefinition>>;
  readonly layout: EditLayout;
  /** Mint success-payload fields merged into the confirm payload (e.g. a
   *  short-lived setup token). Held in component state only — never rendered,
   *  never in the URL, a query cache, nav or a persisted draft. */
  readonly carry?: readonly string[];
  readonly submitLabel?: string;
  /** i18n key for the banner shown after a successful confirm when the screen
   *  declares no `redirect`. Default "kumiko.secretMint.done". */
  readonly doneMessage?: string;
};

export type SecretReveal = {
  readonly fields: readonly SecretRevealField[];
  /** i18n key. Default "kumiko.secretMint.title". */
  readonly title?: string;
  /** i18n key for the "this is the only time you see it" warning.
   *  Default "kumiko.secretMint.warning". */
  readonly warning?: string;
  /** i18n key for the acknowledge button. Default "kumiko.secretMint.confirm". */
  readonly confirmLabel?: string;
  /** i18n key for a checkbox on the reveal card ("I have saved my recovery
   *  codes"). While unchecked, the confirm step's submit or the acknowledge
   *  button stays disabled. The tick is UI-only and never part of a payload. */
  readonly acknowledge?: string;
};

/** Mint form → one-time reveal → explicit confirm. The secret (API token,
 *  recovery codes) lives only in the write-handler's own success payload —
 *  no stored value backs it, so no query can redisplay it later. That gap
 *  is why this needs its own screen type instead of a flag on `actionForm`,
 *  which discards the success payload after extracting the navigation id. */
export type SecretMintScreenDefinition = {
  readonly id: string;
  readonly type: "secretMint";
  readonly nav?: ScreenNavSugar;
  readonly detailFor?: string;
  readonly description?: string;
  readonly agent?: AgentScreenHints;
  /** Screen has no nav entry by design (opened via link or navved by the
   *  app); exempts it from the nav-area boot check. */
  readonly dormant?: boolean;
  /** UI-only gate, also on direct URL access; handlers still enforce access. Unmet or failed renders `fallback`. */
  readonly visibleWhen?: DashboardPanelVisibility;
  /** Same-feature short id or cross-feature QN `<feature>:screen:<id>` shown when `visibleWhen` is unmet (default: standard notice). */
  readonly fallback?: string;
  /** Derived by buildAppSchema — see EntityEditScreenDefinition.urlPrefillFields. */
  readonly urlPrefillFields?: readonly string[];
  /** Submit is enabled without edits: values seeded from navigate `params` count as the
   *  user's intent. Every required field the layout hides with `visible: false` must hold a
   *  value, otherwise submit stays disabled (boot-checked against navigate `params`). */
  readonly submitPrefilled?: boolean;
  /** Write-handler QN dispatched on submit. */
  readonly handler: string;
  readonly fields: Readonly<Record<string, FormFieldDefinition>>;
  readonly layout: EditLayout;
  /** Navigate here after the reveal is confirmed. Short id (same-feature) or
   *  a fully-qualified cross-feature screen QN — no result-id navigation
   *  form exists here (unlike `ActionFormScreenDefinition.redirect`), since
   *  the confirmed screen carries no entity id to thread through. */
  readonly redirect?: string;
  readonly cancelTarget?: string | false;
  readonly listScreenId?: string;
  readonly access?: AccessRule;
  readonly reveal: SecretReveal;
  /** i18n-key for the mint button. Default: renderer's own default. */
  readonly submitLabel?: string;
  /** Proof-of-receipt step rendered on the reveal card in place of the bare
   *  acknowledge button — see `SecretMintConfirmStep` doc. */
  readonly confirm?: SecretMintConfirmStep;
};
