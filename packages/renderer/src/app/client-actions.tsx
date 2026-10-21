// Client-side action handlers for RowAction `kind: "clientAction"`: the schema
// carries only a `<feature>:<kebab>` name, the function lives in a client
// bundle. createKumikoApp collects ClientFeatureDefinition.clientActions into
// ClientActionsProvider (same wiring as extension sections); tests mount the
// provider directly.

import type { RowActionClientAction } from "@cosmicdrift/kumiko-framework/ui-types";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { rendererError } from "../dev-console.ts";
import type { Translate } from "../headless/index.ts";

export type ClientActionOutcome =
  | { readonly ok: true }
  /** `message` is an i18n key; a literal is shown as is. */
  | { readonly ok: false; readonly message: string };

export type ClientActionHandler = (
  payload: Readonly<Record<string, unknown>>,
) => Promise<ClientActionOutcome>;

export type ClientActionsMap = Readonly<Record<string, ClientActionHandler>>;

export type ActionNotice = {
  readonly tone: "success" | "error";
  readonly text: string;
};

/** Shows the outcome of a client action. The platform layer provides it
 *  (renderer/web: a toast); without one a failure is thrown to the action
 *  host's own error surface and a success stays silent. */
export type ActionNotifier = (notice: ActionNotice) => void;

export type ClientActionRuntime = {
  readonly handlers: ClientActionsMap | undefined;
  readonly notify: ActionNotifier | undefined;
};

const ClientActionsContext = createContext<ClientActionsMap | undefined>(undefined);
const ActionNoticeContext = createContext<ActionNotifier | undefined>(undefined);

export function ClientActionsProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: ClientActionsMap;
}): ReactNode {
  return <ClientActionsContext.Provider value={value}>{children}</ClientActionsContext.Provider>;
}

export function ActionNoticeProvider({
  children,
  notify,
}: {
  readonly children: ReactNode;
  readonly notify: ActionNotifier;
}): ReactNode {
  return <ActionNoticeContext.Provider value={notify}>{children}</ActionNoticeContext.Provider>;
}

export function useClientActionHandler(name: string): ClientActionHandler | undefined {
  return findClientActionHandler(useContext(ClientActionsContext), name);
}

/** Handlers plus notifier, as the action builders take them. */
export function useClientActionRuntime(): ClientActionRuntime {
  const handlers = useContext(ClientActionsContext);
  const notify = useContext(ActionNoticeContext);
  return useMemo(() => ({ handlers, notify }), [handlers, notify]);
}

function findClientActionHandler(
  handlers: ClientActionsMap | undefined,
  name: string,
): ClientActionHandler | undefined {
  return handlers !== undefined && Object.hasOwn(handlers, name) ? handlers[name] : undefined;
}

function logClientActionProblem(name: string, problem: string, cause?: unknown): void {
  rendererError(
    `[kumiko] clientAction "${name}" ${problem}`,
    ...(cause === undefined ? [] : [cause]),
  );
}

/** Runs the handler registered for `action.action` and reports the outcome.
 *  Resolves true when the handler returned `{ ok: true }` (the caller then
 *  refetches). A failure goes to the notifier; without one it is thrown so the
 *  host's own error surface (row toast, header banner) shows it. */
export async function runClientAction(options: {
  readonly action: RowActionClientAction;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly runtime: ClientActionRuntime | undefined;
  readonly translate: Translate;
}): Promise<boolean> {
  const { action, payload, runtime, translate } = options;
  const notify = runtime?.notify;
  const fail = (text: string): false => {
    if (notify === undefined) throw new Error(text);
    notify({ tone: "error", text });
    return false;
  };

  const handler = findClientActionHandler(runtime?.handlers, action.action);
  if (handler === undefined) {
    logClientActionProblem(action.action, "is not registered by any client feature");
    return fail(translate("kumiko.clientAction.unregistered"));
  }

  let outcome: ClientActionOutcome;
  try {
    outcome = await handler(payload);
  } catch (error) {
    logClientActionProblem(action.action, "threw", error);
    return fail(translate("kumiko.clientAction.failed"));
  }
  if (!outcome.ok) return fail(translate(outcome.message));

  notify?.({
    tone: "success",
    text: translate(action.successMessage ?? "kumiko.clientAction.success"),
  });
  return true;
}
