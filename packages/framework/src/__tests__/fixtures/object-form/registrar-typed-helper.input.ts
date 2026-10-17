import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";

export function registerOrderHandlers(r: FeatureRegistrar<"orders">): void {
  r.writeHandler("order:touch", touchSchema, touchOrder, { access: { openToAll: { reason: "codemod fixture" } } });
  r.requires("users");
}

export const registerPlain = (registrar: FeatureRegistrar) => {
  registrar.entity("plain", plainEntity);
};
