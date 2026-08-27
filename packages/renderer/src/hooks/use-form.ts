import type {
  FormController,
  FormControllerOptions,
  FormSnapshot,
  FormValues,
} from "@cosmicdrift/kumiko-headless";
import { createFormController } from "@cosmicdrift/kumiko-headless";
import { useMemo, useSyncExternalStore } from "react";
import { useOptionalDispatcher } from "../context/dispatcher-context";

// Thin React wrapper around createFormController. Returns both the
// controller (imperative — setField, submit, reset) and the current
// snapshot (reactive — values, errors, isDirty). React subscribes via
// useSyncExternalStore so re-renders happen exactly when the snapshot
// reference changes, which the controller guarantees.
//
// The `submit.dispatcher` config is filled from context if omitted,
// so the typical call site is just:
//   const { snapshot, controller } = useForm({
//     initial: { ... },
//     schema,
//     submit: { type: "foo:create" },
//   });
// and the hook wires the ambient DispatcherProvider's dispatcher in.

export type UseFormOptions<TValues extends FormValues, TCtx = unknown> = FormControllerOptions<
  TValues,
  TCtx
>;

export type UseFormResult<TValues extends FormValues> = {
  readonly controller: FormController<TValues>;
  readonly snapshot: FormSnapshot<TValues>;
};

export function useForm<TValues extends FormValues, TCtx = unknown>(
  options: UseFormOptions<TValues, TCtx>,
): UseFormResult<TValues> {
  // Optional: a form with no `submit` config (or one with an explicit
  // dispatcher) never needs the ambient one, and mounting without a
  // DispatcherProvider must not crash just because useForm was called.
  const contextDispatcher = useOptionalDispatcher();

  // The controller is created once per mount. `options` mutates across
  // renders in normal React usage (closures get new references), but
  // the controller's behaviour depends only on the initial shape — we
  // deliberately don't re-create on option-identity change, which
  // would wipe in-flight state and "forget" dirty edits on every
  // parent re-render. If the app needs a reset, call controller.reset()
  // or re-mount the form (key prop).
  // Controller lifetime = hook lifetime. Options deliberately NOT in
  // the deps array; re-creating on option-identity change would wipe
  // in-flight state and dirty edits on every parent re-render.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional — controller is lifetime-scoped, not render-scoped
  const controller = useMemo<FormController<TValues>>(() => {
    // Default submit.dispatcher to the ambient one when omitted.
    type FullOptions = FormControllerOptions<TValues, TCtx>;
    const rawSubmit = options.submit;
    const submitConfig: FullOptions["submit"] = rawSubmit
      ? { ...rawSubmit, dispatcher: rawSubmit.dispatcher ?? contextDispatcher }
      : undefined;
    const controllerOptions: FullOptions = {
      ...(options as FullOptions),
      ...(submitConfig !== undefined && { submit: submitConfig }),
    };
    return createFormController<TValues, TCtx>(controllerOptions);
  }, []);

  const snapshot = useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.getSnapshot(),
    // SSR snapshot: same as getSnapshot(). The controller's initial
    // snapshot is deterministic from options.initial, safe for server.
    () => controller.getSnapshot(),
  );

  return { controller, snapshot };
}
