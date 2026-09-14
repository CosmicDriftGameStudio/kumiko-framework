import { describe, expect, test } from "bun:test";
import {
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
  synthesizeSecretMintConfirmScreen,
} from "../action-form-shim";

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

  test("carries description through so RenderEdit can render it as the form subtitle (fw#2723)", () => {
    const withDescription = synthesizeActionFormScreen({
      id: "invite-user",
      type: "actionForm",
      description: "Invite a new team member by email.",
      handler: "users:write:invite-user",
      layout: { sections: [{ title: "Invite", fields: ["email"] }] },
      fields: { email: { type: "text" } },
    });
    expect(withDescription.description).toBe("Invite a new team member by email.");

    const withoutDescription = synthesizeActionFormScreen({
      id: "invite-user",
      type: "actionForm",
      handler: "users:write:invite-user",
      layout: { sections: [{ title: "Invite", fields: ["email"] }] },
      fields: { email: { type: "text" } },
    });
    expect("description" in withoutDescription).toBe(false);
  });

  test("carries slots through so RenderEdit can mount header/footer slots on an actionForm", () => {
    const withSlots = synthesizeActionFormScreen({
      id: "invite-user",
      type: "actionForm",
      handler: "users:write:invite-user",
      layout: { sections: [{ title: "Invite", fields: ["email"] }] },
      fields: { email: { type: "text" } },
      slots: { footer: { react: { __component: "f" } } },
    });
    expect(withSlots.slots).toEqual({ footer: { react: { __component: "f" } } });

    const withoutSlots = synthesizeActionFormScreen({
      id: "invite-user",
      type: "actionForm",
      handler: "users:write:invite-user",
      layout: { sections: [{ title: "Invite", fields: ["email"] }] },
      fields: { email: { type: "text" } },
    });
    expect("slots" in withoutSlots).toBe(false);
  });

  test("carries fieldLabels through so RenderEdit resolves the screen's own label override (fw akte-bedienkonzept-2 F1)", () => {
    const withFieldLabels = synthesizeActionFormScreen({
      id: "reschedule",
      type: "actionForm",
      handler: "shop:write:reschedule",
      layout: { sections: [{ title: "Reschedule", fields: ["dueAt"] }] },
      fields: { dueAt: { type: "date" } },
      fieldLabels: { dueAt: "shop:reschedule.dueAt" },
    });
    expect(withFieldLabels.fieldLabels).toEqual({ dueAt: "shop:reschedule.dueAt" });

    const withoutFieldLabels = synthesizeActionFormScreen({
      id: "reschedule",
      type: "actionForm",
      handler: "shop:write:reschedule",
      layout: { sections: [{ title: "Reschedule", fields: ["dueAt"] }] },
      fields: { dueAt: { type: "date" } },
    });
    expect("fieldLabels" in withoutFieldLabels).toBe(false);
  });
});

describe("synthesizeSecretMintConfirmScreen (fw#2838)", () => {
  test("maps a secretMint's confirm step to the entityEdit shape RenderEdit expects, with a distinct id", () => {
    const screen = synthesizeSecretMintConfirmScreen(
      {
        id: "mint-token",
        type: "secretMint",
        handler: "shop:write:token:mint",
        fields: { label: { type: "text" } },
        layout: { sections: [{ title: "Mint", fields: ["label"] }] },
        reveal: { fields: [{ field: "token", label: "Token" }] },
      },
      {
        handler: "shop:write:token:confirm",
        fields: { code: { type: "text" } },
        layout: { sections: [{ title: "Confirm", fields: ["code"] }] },
      },
    );
    expect(screen.id).toBe("mint-token:confirm");
    expect(screen.type).toBe("entityEdit");
    expect(screen.entity).toBe("__action-form__");
    expect(screen.layout).toEqual({ sections: [{ title: "Confirm", fields: ["code"] }] });
  });

  test("carries the mint screen's access rule through to the confirm form", () => {
    const screen = synthesizeSecretMintConfirmScreen(
      {
        id: "mint-token",
        type: "secretMint",
        handler: "shop:write:token:mint",
        fields: { label: { type: "text" } },
        layout: { sections: [{ title: "Mint", fields: ["label"] }] },
        reveal: { fields: [{ field: "token", label: "Token" }] },
        access: { roles: ["admin"] },
      },
      {
        handler: "shop:write:token:confirm",
        fields: { code: { type: "text" } },
        layout: { sections: [{ title: "Confirm", fields: ["code"] }] },
      },
    );
    expect(screen.access).toEqual({ roles: ["admin"] });
  });
});
