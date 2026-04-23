import type { ZodType } from "zod";
import type { Dispatcher, FieldIssue, WriteResult } from "../dispatcher";

// Form-Controller contract.
//
// One controller per edit/create screen. Wraps a mutable "values" record
// plus derived state (changes vs initial, per-field errors) and exposes a
// subscribe API shaped for React's `useSyncExternalStore`. The framework's
// renderer-react wraps this in a thin `useForm` hook; the mobile renderer
// will do the same with the same controller.
//
// Why not just Zustand / a state library?
// Form state has a small, well-defined shape — values, initial, changes,
// errors, per-field meta. Building it on raw subscribe/emit keeps the
// runtime deps at zero (this package imports nothing but types from
// @kumiko/framework and zod), and leaves renderer-specific decisions
// (batching, suspense) to the host framework.
//
// Snapshot identity: `getSnapshot()` returns the SAME reference until a
// mutator (setField / setValues / reset / ...) runs. React compares by
// identity when deciding whether to re-render — recomputing the snapshot
// on every call would re-render on every tick. Mutators rebuild the
// snapshot once, then notify listeners.

export type FormValues = Record<string, unknown>;

// Per-field conditional rules (Kumiko's "visible/readonly/required as
// functions" decision, 2026-03-30). A rule is either a static boolean or a
// predicate `(values, ctx) => boolean`. The controller evaluates them on
// every snapshot rebuild and exposes the resolved booleans as
// FieldState — renderers read `snapshot.fields[key].visible` and never
// re-evaluate the predicate themselves.
//
// Why here and not on the framework's FieldDefinition: conditions are
// UI-layer concerns (visibility depends on form state, not entity state)
// and shouldn't couple the server-side schema. The App wires them up per
// screen via the screen-def / form-controller options. The framework's
// own `field.required` is mirrored here when present, so feature authors
// can still declare "always required" once at the entity level.
export type FieldConditionPredicate<TValues extends FormValues, TCtx> = (
  values: TValues,
  ctx: TCtx,
) => boolean;

export type FieldConditionValue<TValues extends FormValues, TCtx> =
  | boolean
  | FieldConditionPredicate<TValues, TCtx>;

export type FieldConditions<TValues extends FormValues, TCtx = unknown> = {
  readonly visible?: FieldConditionValue<TValues, TCtx>;
  readonly readonly?: FieldConditionValue<TValues, TCtx>;
  readonly required?: FieldConditionValue<TValues, TCtx>;
};

// Resolved per-field state, keyed by field name, surfaced on the snapshot.
// Defaults (when no condition is declared): visible=true, readonly=false,
// required=false — renderer treats a field with no rules as a normal
// always-shown-always-editable field.
export type FieldState = {
  readonly visible: boolean;
  readonly readonly: boolean;
  readonly required: boolean;
};

// Immutable view handed to renderers. Every mutator call produces a fresh
// snapshot; previous snapshot references stay valid for `useSyncExternalStore`'s
// identity compare.
export type FormSnapshot<TValues extends FormValues> = {
  // Current values — the user's in-progress edit.
  readonly values: TValues;
  // Pristine values at mount / last `reset()`. Needed for:
  //   - diffing `changes` (see below)
  //   - the "discard changes?" prompt when the user navigates away dirty
  //   - re-hydrating the form after an optimistic-update rollback
  readonly initial: TValues;
  // Changes-only: keys whose current value differs from initial, with the
  // NEW value. The server uses this directly as the `payload` of an
  // entity-level update command (Kumiko writes carry changes, not full
  // objects) — see `docs/plans/architecture/event-sourcing-pivot.md`.
  readonly changes: Partial<TValues>;
  // True iff `changes` is non-empty. Convenience for the submit-button's
  // disabled state and the unsaved-changes guard.
  readonly isDirty: boolean;
  // True iff no field was touched, kept separate from `isDirty` so UI code
  // reads the right one without negation (= `!isDirty`). Form consumers
  // will reach for both — they're not symmetric in intent (one is "can I
  // submit?" and the other is "can I safely close?").
  readonly isUnchanged: boolean;
  // Per-field errors keyed by dotted path (`title`, `address.city`,
  // `tasks.2.title`). Empty when the form is valid, populated after
  // `validate()` or a failed submit. The dotted convention matches the
  // server's ValidationError.fields[].path — a failed dispatcher call
  // pushes its field issues here without any translation.
  readonly errors: Readonly<Record<string, readonly FieldIssue[]>>;
  // Resolved per-field state from FieldConditions. Renderers read this to
  // decide whether to show the field, whether the input is disabled, and
  // whether to show the required-marker. Fields without declared
  // conditions default to `{ visible: true, readonly: false, required: false }`.
  readonly fields: Readonly<Record<string, FieldState>>;
};

export type FormController<TValues extends FormValues> = {
  // --- Subscribe surface (for useSyncExternalStore) ---

  // Returns the current snapshot. SAME reference across calls until a
  // mutator runs — callers rely on identity compare.
  getSnapshot(): FormSnapshot<TValues>;

  // Registers a listener that fires whenever the snapshot changes. Returns
  // an unsubscribe function. Matches the `subscribe(listener) => unsubscribe`
  // shape required by `useSyncExternalStore`.
  subscribe(listener: () => void): () => void;

  // --- Value mutators ---

  // Sets one field. For scalar fields, `value` is the new value; for
  // nested paths (lines/sub-forms) you'd use a sub-controller (Block 2b.4)
  // instead of poking this with a dotted path.
  setField<K extends keyof TValues>(key: K, value: TValues[K]): void;

  // Bulk-update multiple fields at once. One snapshot rebuild + one
  // notify, so a 5-field form-reset from a remote fetch doesn't cascade 5
  // re-renders.
  setValues(partial: Partial<TValues>): void;

  // Clears field-level errors, keyed by dotted path. Used when the user
  // starts typing again in a field that had a server-side failure —
  // the UX hint should go away immediately, before the next validate()
  // run. Pass no arguments to clear ALL errors.
  clearErrors(path?: string): void;

  // Replaces all errors (overwrite, not merge). Used by submit() to
  // surface server-side validation failures and by external callers
  // that want to project custom error state (e.g. a parent controller
  // pushing down cross-field errors onto its children).
  setErrors(errors: Readonly<Record<string, readonly FieldIssue[]>>): void;

  // --- Validation ---

  // Runs the controller's zod schema (if configured) against current
  // values. Populates errors and returns true iff valid. Noop-returns
  // `true` when no schema was wired — a controller without a schema
  // relies entirely on server-side validation via the submit() path.
  validate(): boolean;

  // Reverts values to `initial`, clears errors. Doesn't fire a new
  // "initial" baseline — to adopt the current values as the new baseline
  // (e.g. after a successful submit), use `rebase()`.
  reset(): void;

  // Promotes the current values to the new `initial`, clears errors.
  // After a successful submit the user should no longer see "unsaved
  // changes" — rebase() is what the submit path calls internally to
  // achieve that.
  rebase(): void;

  // Swap the external context threaded into field-condition predicates.
  // Rare — most conditionals depend on values, not ctx — but needed when
  // e.g. the user switches tenant mid-form and visibility rules key off
  // tenant-scoped config.
  setCtx(ctx: unknown): void;

  // --- Submit ---
  //
  // Runs validate() first; if it fails, returns `{ validationBlocked: true,
  // isSuccess: false }` WITHOUT a network call (the caller knows it's a
  // user-level failure — show the errors, let them retry).
  //
  // If validation passes, dispatches to the configured submit.type with
  // values or changes per submit.payloadMode. On server-side
  // ValidationError, the error's field issues are pushed onto the form
  // via setErrors so the UI reacts identically to local and remote
  // validation failures. On success, rebase() — the form becomes "clean"
  // and the data returned by the handler flows back via the result.
  //
  // Throws (not returns a failure) if `submit` config wasn't provided —
  // a controller without submit-wiring has no destination, and guessing
  // one would hide an integration bug.
  submit<TData = unknown>(): Promise<SubmitResult<TData>>;
};

export type FormControllerOptions<TValues extends FormValues, TCtx = unknown> = {
  readonly initial: TValues;
  // Optional zod schema used by `validate()`. When present, validate()
  // runs schema.safeParse(values) and populates the snapshot's errors
  // map. When absent, validate() is a no-op that returns true — the
  // controller defers entirely to server-side validation on submit.
  //
  // Typed as `ZodType` (not `ZodType<TValues>`) because a feature's
  // input schema often narrows a subset of the form's surface (e.g.
  // "changes-only" update-schemas) and re-exporting that precise type
  // all the way through would chain generics across every layer. The
  // runtime contract is that schema accepts the form's `values` shape.
  readonly schema?: ZodType;
  // Per-field conditional rules. Keyed by field name; unlisted fields
  // get the default {visible:true, readonly:false, required:false}.
  // See FieldConditions for the predicate signature.
  readonly fields?: Readonly<Record<string, FieldConditions<TValues, TCtx>>>;
  // External context passed to every field-condition predicate. Host app
  // picks the shape — typically `{ user, tenant, config, featureToggles }`.
  // Captured once; a ctx change without a corresponding setField/validate
  // won't re-evaluate predicates. Use setCtx() to trigger re-evaluation
  // when the ctx itself changes (rare in practice — most conditionals
  // depend on values, not ctx).
  readonly ctx?: TCtx;
  // Optional submit wiring. When configured, `controller.submit()` runs
  // local validate() then dispatches to the configured type with the
  // selected payload, maps server-side field errors back onto the form,
  // and — on success — rebases so "unsaved changes" goes quiet.
  //
  // Omitted when the caller drives dispatching manually (custom-screen
  // cases, or when a multi-step wizard needs finer control). In that
  // case submit() throws rather than guessing a destination.
  readonly submit?: SubmitConfig<TValues>;
};

// How the form's payload is derived when submit() runs. Kumiko's write
// convention says commands carry CHANGES (delta since initial), not full
// objects — but that assumes an update flow. For creates, `changes ===
// values` in practice because initial is empty.
//
//   - "values"  — send the full current `values` object. Right for create
//                 handlers whose schema expects a full entity payload.
//   - "changes" — send only the `changes` delta. Right for update
//                 handlers; noop when the form is un-dirty (submit
//                 short-circuits into a no-network success).
//
// Default is "values" — the common M1 case is a create-screen wiring
// straight through. Update-screens opt in with "changes".
export type SubmitPayloadMode = "values" | "changes";

export type SubmitConfig<TValues extends FormValues = FormValues> = {
  readonly dispatcher: Dispatcher;
  // Qualified write-handler name (e.g. "orders:write:order:create").
  readonly type: string;
  readonly payloadMode?: SubmitPayloadMode;
  // Optional payload transformer — overrides payloadMode. Used for
  // nested-writes: the submit path calls buildPayload(snapshot) once at
  // submit-time and sends the result. The snapshot is the one captured
  // before the network call, so in-flight edits during the await don't
  // leak into the payload.
  //
  // Typical shape for a parent form with hasMany child controllers:
  //
  //   buildPayload: (snap) => ({
  //     ...snap.values,
  //     lines: lineControllers.map(c => c.getSnapshot().values),
  //   })
  //
  // When both buildPayload and payloadMode are set, buildPayload wins.
  // That's intentional: a caller choosing to write a transformer is
  // making an explicit statement about payload shape.
  readonly buildPayload?: (snapshot: FormSnapshot<TValues>) => unknown;
};

// What submit() returns. Mirrors WriteResult so a failed submit can
// carry the structured DispatcherError unchanged — callers log or toast
// based on error.code without the form-controller guessing UX intent.
// `validationBlocked: true` signals a LOCAL (pre-dispatch) validate()
// failure — no network call happened; caller doesn't need to retry the
// network, the user needs to fix fields.
export type SubmitResult<TData = unknown> =
  | ({ readonly validationBlocked: false } & WriteResult<TData>)
  | { readonly validationBlocked: true; readonly isSuccess: false };
