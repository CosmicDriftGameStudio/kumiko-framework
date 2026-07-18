import type { FieldIssue } from "../dispatcher";
import { createStore } from "../store";
import type {
  FieldConditions,
  FieldConditionValue,
  FieldState,
  FormController,
  FormControllerOptions,
  FormSnapshot,
  FormValues,
  SubmitResult,
} from "./types";
import { groupIssuesByPath, zodErrorToFieldIssues } from "./zod-bridge";

// Resolve one condition-value (boolean | predicate) against current values + ctx.
// `undefined` means "condition not declared"; the caller substitutes the
// field-default (visible:true, readonly:false, required:false).
function evalCondition<TValues extends FormValues, TCtx>(
  condition: FieldConditionValue<TValues, TCtx> | undefined,
  fallback: boolean,
  values: TValues,
  ctx: TCtx,
): boolean {
  if (condition === undefined) return fallback;
  if (typeof condition === "boolean") return condition;
  return condition(values, ctx);
}

function computeFieldStates<TValues extends FormValues, TCtx>(
  rules: Readonly<Record<string, FieldConditions<TValues, TCtx>>> | undefined,
  values: TValues,
  ctx: TCtx,
): Record<string, FieldState> {
  if (!rules) return {};
  const out: Record<string, FieldState> = {};
  for (const [fieldKey, rule] of Object.entries(rules)) {
    out[fieldKey] = {
      visible: evalCondition(rule.visible, true, values, ctx),
      readonly: evalCondition(rule.readonly, false, values, ctx),
      required: evalCondition(rule.required, false, values, ctx),
    };
  }
  return out;
}

// Reference equality only. For primitive-valued fields this is exact; for
// object/array fields it treats "same reference" as "unchanged" — callers
// who mutate in place instead of swapping references (which is bad form
// anyway, but common in ad-hoc tests) would miss a change. Kumiko's
// form-controller contract is that mutators build new references.
// Object.is is chosen over === so NaN !== NaN doesn't mark a field dirty
// after you re-type the same number back in.
function valuesDiff<TValues extends FormValues>(
  current: TValues,
  initial: TValues,
): Partial<TValues> {
  const out: Partial<TValues> = {};
  // Iterate over BOTH sides — a field that existed on initial but was
  // deleted from current (via `setValues({ foo: undefined })`) still
  // counts as a change.
  // FormValues<T> erlaubt kein keyof-T-Iteration (T ist generic). Cast
  // zu Record<string, unknown> für dynamic-key-Inspection.
  const cur = current as Record<string, unknown>; // @cast-boundary form-values
  const ini = initial as Record<string, unknown>; // @cast-boundary form-values
  const o = out as Record<string, unknown>; // @cast-boundary form-values
  const keys = new Set<string>([...Object.keys(cur), ...Object.keys(ini)]);
  for (const key of keys) {
    const a = cur[key];
    const b = ini[key];
    if (!Object.is(a, b)) {
      o[key] = a;
    }
  }
  return out;
}

// Shallow-freeze so accidental mutations on the snapshot (e.g. a test
// writing `snapshot.values.title = "x"`) throw in strict mode instead of
// silently diverging from the controller's internal state. Deep-freeze
// would be safer but expensive — keeping it shallow matches React's own
// immutability expectations and leaves room for sub-controllers to manage
// their own sub-trees without double-frozen parents blocking them.
function freezeSnapshot<TValues extends FormValues>(
  snapshot: FormSnapshot<TValues>,
): FormSnapshot<TValues> {
  return Object.freeze(snapshot);
}

export function createFormController<TValues extends FormValues, TCtx = unknown>(
  options: FormControllerOptions<TValues, TCtx>,
): FormController<TValues> {
  // Shallow copy so mutating the input after creation doesn't bleed into
  // the controller's internal state. `initial` stays fixed across the
  // controller's lifetime unless rebase() replaces it.
  let values: TValues = { ...options.initial };
  let initial: TValues = { ...options.initial };
  let errors: Readonly<Record<string, readonly FieldIssue[]>> = Object.freeze({});
  // ctx is cast-held as TCtx; `undefined` is valid when callers don't
  // declare conditional predicates that depend on it.
  let ctx: TCtx = (options.ctx as TCtx) ?? (undefined as TCtx);

  // Snapshot lives in a Store — same reference across getSnapshot() calls
  // until a mutator invalidates it via setState. React's useSyncExternalStore
  // compares snapshot identity to decide on a re-render; the Store holds the
  // identity stable until invalidate() swaps it for a fresh build.
  const snapshotStore = createStore<FormSnapshot<TValues>>(buildSnapshot());

  // In-flight submit tracker. When a submit() is pending, a second call
  // awaits the same promise instead of firing a parallel write — avoids
  // double-submission on double-click and keeps the rebase semantics
  // coherent (rebasing twice in quick succession would mis-align the
  // baseline with what the server actually saw).
  let submitInFlight: Promise<unknown> | null = null;

  function buildSnapshot(): FormSnapshot<TValues> {
    const changes = valuesDiff(values, initial);
    const isDirty = Object.keys(changes).length > 0;
    const fields = Object.freeze(computeFieldStates(options.fields, values, ctx));
    return freezeSnapshot({
      values,
      initial,
      changes,
      isDirty,
      isUnchanged: !isDirty,
      errors,
      fields,
    });
  }

  function invalidate() {
    snapshotStore.setState(buildSnapshot());
  }

  // Local shared implementations so submit() can call validate/rebase
  // without the this-in-object-literal dance. Both also expose themselves
  // as methods on the returned controller.
  function runValidate(): boolean {
    if (!options.schema) {
      if (Object.keys(errors).length > 0) {
        errors = Object.freeze({});
        invalidate();
      }
      return true;
    }
    const fieldStates = computeFieldStates(options.fields, values, ctx);
    const parsed = options.schema.safeParse(values);
    if (parsed.success) {
      if (Object.keys(errors).length > 0) {
        errors = Object.freeze({});
        invalidate();
      }
      return true;
    }
    const hiddenFields = new Set<string>();
    for (const [fieldKey, state] of Object.entries(fieldStates)) {
      if (!state.visible) hiddenFields.add(fieldKey);
    }
    const allIssues = zodErrorToFieldIssues(parsed.error);
    const relevantIssues = allIssues.filter((issue) => {
      const rootField = issue.path.split(".")[0] ?? "";
      return !hiddenFields.has(rootField);
    });
    if (relevantIssues.length === 0) {
      if (Object.keys(errors).length > 0) {
        errors = Object.freeze({});
        invalidate();
      }
      return true;
    }
    errors = Object.freeze(groupIssuesByPath(relevantIssues));
    invalidate();
    return false;
  }

  function runRebase(): void {
    initial = { ...values };
    if (Object.keys(errors).length > 0) errors = Object.freeze({});
    invalidate();
  }

  // Stale-submit-safe rebase. Difference to runRebase: the baseline is
  // taken from the values that were actually SENT to the server, not
  // from `values` at the moment the server replied. If the user typed
  // into a field while the submit was in flight, those edits stay as
  // dirty changes after the call — they never made it to the server, so
  // pretending they did (via `initial = { ...values }`) would mask unsaved
  // input. The race shows up as "user edits a field during a 2s save, sees
  // it as saved, closes the tab — the edit is lost". This path keeps
  // `values` untouched; only `initial` shifts to the submitted snapshot.
  function runRebaseToSnapshot(snapped: TValues): void {
    initial = { ...snapped };
    if (Object.keys(errors).length > 0) errors = Object.freeze({});
    invalidate();
  }

  return {
    getSnapshot: snapshotStore.getSnapshot,
    subscribe: snapshotStore.subscribe,
    setField(key, value) {
      // skip: value unchanged, avoid notify/re-render on identical set
      // avoids a notify + re-render for "setField with same value" which
      // happens a lot in controlled inputs on every keystroke of an
      // untouched field.
      if (Object.is(values[key], value)) return;
      values = { ...values, [key]: value };
      invalidate();
    },
    setValues(partial) {
      // skip: partial matches current values, avoid no-op notify
      // partial that matches current values shouldn't fire listeners.
      let changed = false;
      const v = values as Record<string, unknown>; // @cast-boundary form-values
      const p = partial as Record<string, unknown>; // @cast-boundary form-values
      for (const k of Object.keys(p)) {
        if (!Object.is(v[k], p[k])) {
          changed = true;
          break;
        }
      }
      // skip: no key in partial actually changed, avoid no-op notify
      if (!changed) return;
      values = { ...values, ...partial };
      invalidate();
    },
    clearErrors(path) {
      if (path === undefined) {
        // skip: no errors present, avoid no-op notify
        if (Object.keys(errors).length === 0) return;
        errors = Object.freeze({});
      } else {
        // skip: path has no error entry, avoid no-op notify
        if (!(path in errors)) return;
        const next: Record<string, readonly FieldIssue[]> = { ...errors };
        delete next[path];
        errors = Object.freeze(next);
      }
      invalidate();
    },
    setErrors(nextErrors) {
      errors = Object.freeze({ ...nextErrors });
      invalidate();
    },
    validate: runValidate,
    reset() {
      const alreadyClean = !snapshotStore.getSnapshot().isDirty && Object.keys(errors).length === 0;
      // skip: already at baseline with no errors, no-op reset
      if (alreadyClean) return;
      values = { ...initial };
      errors = Object.freeze({});
      invalidate();
    },
    rebase: runRebase,
    setCtx(nextCtx) {
      // Cast back to TCtx: setCtx's public signature takes unknown so
      // callers don't need to plumb generics. If conditions depend on ctx
      // and callers pass the wrong shape, the predicate throws at
      // evaluation time — which is the same fail mode as any other
      // callback contract violation.
      ctx = nextCtx as TCtx;
      invalidate();
    },
    async submit<TData = unknown>(): Promise<SubmitResult<TData>> {
      const submitCfg = options.submit;
      if (!submitCfg) {
        throw new Error(
          "createFormController: submit() called without a `submit` config. Configure `{ dispatcher, type }` on the controller or drive dispatching manually.",
        );
      }

      // Concurrent-submit guard: a double-click (two invocations before
      // the first network call returned) would otherwise fire two writes
      // AND rebase twice — compounding with the stale-submit race below.
      // Serialize: subsequent calls await the in-flight promise. Same
      // pattern the server-side event-dispatcher uses (passInFlight).
      if (submitInFlight) return submitInFlight as Promise<SubmitResult<TData>>;

      if (!runValidate()) {
        return { validationBlocked: true, isSuccess: false };
      }

      const payloadMode = submitCfg.payloadMode ?? "values";
      // Capture the whole snapshot AT submit-time. The user may keep
      // typing while the network call is in flight; on success we rebase
      // ONLY to the values that were actually sent, leaving any
      // subsequent edits as a fresh dirty delta. Without this, an edit
      // during the await would be swallowed into the new baseline and
      // the user would see it as "saved" despite the server never seeing
      // it. Same snapshot is fed to buildPayload — a custom transformer
      // (nested-write case) sees exactly what submit() sees.
      const submittedSnapshot = snapshotStore.getSnapshot();
      const submittedValues = submittedSnapshot.values;

      // buildPayload wins over payloadMode when both are set.
      let payload: unknown;
      if (submitCfg.buildPayload) {
        payload = submitCfg.buildPayload(submittedSnapshot);
      } else if (payloadMode === "changes") {
        if (submittedSnapshot.isUnchanged) {
          return {
            validationBlocked: false,
            isSuccess: true,
            data: submittedValues as unknown as TData,
          };
        }
        payload = submittedSnapshot.changes;
      } else {
        payload = submittedValues;
      }

      const runWrite = async (): Promise<SubmitResult<TData>> => {
        const result = await submitCfg.dispatcher.write<TData>(submitCfg.type, payload);

        if (result.isSuccess) {
          // Rebase to the SNAPSHOT, not to the current values — see
          // runRebaseToSnapshot comment for why.
          runRebaseToSnapshot(submittedValues);
          return { validationBlocked: false, isSuccess: true, data: result.data };
        }

        const serverFields = result.error.details?.fields;
        if (serverFields && serverFields.length > 0) {
          errors = Object.freeze(groupIssuesByPath(serverFields));
          invalidate();
        }
        return { validationBlocked: false, isSuccess: false, error: result.error };
      };

      submitInFlight = runWrite();
      try {
        return await (submitInFlight as Promise<SubmitResult<TData>>);
      } finally {
        submitInFlight = null;
      }
    },
  };
}
