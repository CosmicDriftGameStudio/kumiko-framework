import { describe, expect, test } from "bun:test";
import { synthesizeActionFormEntity, synthesizeActionFormScreen } from "../action-form-shim";

describe("synthesizeActionFormEntity", () => {
  test("wraps inline fields as minimal EntityDefinition", () => {
    const entity = synthesizeActionFormEntity({
      title: { type: "text" },
    });
    expect(entity.fields["title"]).toEqual({ type: "text" });
  });
});

describe("synthesizeActionFormScreen", () => {
  test("maps actionForm screen to entityEdit shape", () => {
    const screen = synthesizeActionFormScreen({
      id: "invite-user",
      type: "actionForm",
      handler: "users:write:invite-user",
      layout: { sections: [{ title: "Invite", fields: ["email"] }] },
      fields: { email: { type: "text" } },
    });
    expect(screen.type).toBe("entityEdit");
    expect(screen.entity).toBe("__action-form__");
    expect(screen.layout).toEqual({ sections: [{ title: "Invite", fields: ["email"] }] });
  });
});
