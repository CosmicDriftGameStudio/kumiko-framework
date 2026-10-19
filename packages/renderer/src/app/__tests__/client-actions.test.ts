import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { RowActionClientAction } from "@cosmicdrift/kumiko-framework/ui-types";
import {
  type ActionNotice,
  type ClientActionRuntime,
  runClientAction,
} from "../client-actions.tsx";

const action: RowActionClientAction = {
  kind: "clientAction",
  id: "ping",
  label: "x:ping",
  action: "x:ping",
};
const translate = (key: string): string => `t(${key})`;

let consoleError: ReturnType<typeof spyOn>;
beforeEach(() => {
  consoleError = spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  consoleError.mockRestore();
});

function runtimeWith(
  handler: ClientActionRuntime["handlers"],
): ClientActionRuntime & { readonly notices: ActionNotice[] } {
  const notices: ActionNotice[] = [];
  return { handlers: handler, notify: (notice) => notices.push(notice), notices };
}

describe("runClientAction", () => {
  test("success notifies with the default text and resolves true", async () => {
    const runtime = runtimeWith({ "x:ping": async () => ({ ok: true }) });

    expect(await runClientAction({ action, payload: {}, runtime, translate })).toBe(true);
    expect(runtime.notices).toEqual([{ tone: "success", text: "t(kumiko.clientAction.success)" }]);
  });

  test("a declared successMessage replaces the default text", async () => {
    const runtime = runtimeWith({ "x:ping": async () => ({ ok: true }) });

    await runClientAction({
      action: { ...action, successMessage: "x:sent" },
      payload: {},
      runtime,
      translate,
    });

    expect(runtime.notices).toEqual([{ tone: "success", text: "t(x:sent)" }]);
  });

  test("hands the payload to the handler", async () => {
    const handler = mock(async (_payload: Readonly<Record<string, unknown>>) => ({
      ok: true as const,
    }));

    await runClientAction({
      action,
      payload: { id: "u1" },
      runtime: runtimeWith({ "x:ping": handler }),
      translate,
    });

    expect(handler.mock.calls[0]?.[0]).toEqual({ id: "u1" });
  });

  test("a failure outcome notifies the translated message and resolves false", async () => {
    const runtime = runtimeWith({ "x:ping": async () => ({ ok: false, message: "x:nope" }) });

    expect(await runClientAction({ action, payload: {}, runtime, translate })).toBe(false);
    expect(runtime.notices).toEqual([{ tone: "error", text: "t(x:nope)" }]);
  });

  test("an unregistered name does not fall back to a prototype property", async () => {
    const runtime = runtimeWith({});

    expect(
      await runClientAction({
        action: { ...action, action: "toString" },
        payload: {},
        runtime,
        translate,
      }),
    ).toBe(false);
    expect(runtime.notices).toEqual([
      { tone: "error", text: "t(kumiko.clientAction.unregistered)" },
    ]);
  });

  test("without a notifier a failure is thrown to the host's error surface", async () => {
    const runtime: ClientActionRuntime = {
      handlers: { "x:ping": async () => ({ ok: false, message: "x:nope" }) },
      notify: undefined,
    };

    await expect(runClientAction({ action, payload: {}, runtime, translate })).rejects.toThrow(
      "t(x:nope)",
    );
  });
});
