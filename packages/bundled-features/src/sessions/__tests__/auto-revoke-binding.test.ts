import { describe, expect, mock, test } from "bun:test";
import type { AppContext, SaveContext } from "@cosmicdrift/kumiko-framework/engine";
import { bindAutoRevokeFromFeature, createSessionsFeature } from "../feature";

// The postSave hook is registered unconditionally; the revoker arrives either
// as the explicit constructor option or late-bound by run{Prod,Dev}App via
// bindAutoRevokeOnPasswordChange. These tests pin the binding + precedence
// semantics at the hook level — the full DB sweep is covered by
// password-auto-revoke.integration.test.ts.

const passwordChange: SaveContext = {
  kind: "save",
  id: "user-1",
  data: {},
  changes: { passwordHash: "new-hash" },
  previous: {},
  isNew: false,
};

// @cast-boundary test fixture — the hook never touches AppContext
const appContext = {} as unknown as AppContext;

function userPostSaveHook(feature: ReturnType<typeof createSessionsFeature>) {
  const hook = feature.entityHooks?.postSave?.["user"]?.[0];
  if (!hook) throw new Error("sessions feature did not register the user postSave hook");
  return (ctx: SaveContext) => hook.fn(ctx, appContext);
}

describe("sessions auto-revoke binding", () => {
  test("late-bound revoker fires on password change", async () => {
    const revoker = mock(async (_userId: string) => 1);
    const feature = createSessionsFeature();

    const bind = bindAutoRevokeFromFeature(feature);
    expect(bind).toBeDefined();
    bind?.(revoker);

    await userPostSaveHook(feature)(passwordChange);
    expect(revoker).toHaveBeenCalledTimes(1);
    expect(revoker).toHaveBeenCalledWith("user-1");
  });

  test("unbound hook is a silent no-op", async () => {
    const feature = createSessionsFeature();
    // must resolve without throwing — stateless-JWT deployments have no revoker
    const result = await userPostSaveHook(feature)(passwordChange);
    expect(result).toBeUndefined();
  });

  test("skips isNew and non-passwordHash changes", async () => {
    const revoker = mock(async (_userId: string) => 1);
    const feature = createSessionsFeature();
    bindAutoRevokeFromFeature(feature)?.(revoker);

    await userPostSaveHook(feature)({ ...passwordChange, isNew: true });
    await userPostSaveHook(feature)({ ...passwordChange, changes: { displayName: "x" } });
    expect(revoker).not.toHaveBeenCalled();
  });

  test("explicit constructor option wins over the runtime binding", async () => {
    const explicit = mock(async (_userId: string) => 1);
    const lateBound = mock(async (_userId: string) => 1);
    const feature = createSessionsFeature({ autoRevokeOnPasswordChange: explicit });

    bindAutoRevokeFromFeature(feature)?.(lateBound);
    await userPostSaveHook(feature)(passwordChange);

    expect(explicit).toHaveBeenCalledWith("user-1");
    expect(lateBound).not.toHaveBeenCalled();
  });
});
