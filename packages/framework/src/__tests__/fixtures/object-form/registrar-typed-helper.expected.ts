import type { FeatureRegistrar } from "@cosmicdrift/kumiko-framework/engine";

export function registerOrderHandlers(r: FeatureRegistrar<"orders">): void {
  r.writeHandler({ name: "order:touch", schema: touchSchema, handler: touchOrder, access: { roles: ["ShopOwner"] } });
  r.requires({ features: ["users"] });
}

export const registerPlain = (registrar: FeatureRegistrar) => {
  registrar.entity({ name: "plain", ...plainEntity });
};
