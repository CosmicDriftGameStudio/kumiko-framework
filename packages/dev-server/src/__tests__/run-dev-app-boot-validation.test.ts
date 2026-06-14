// runDevApp muss denselben Boot-Validator wie runProdApp ausführen (#359):
// eine ganze Fehlerklasse (unqualifizierte nav-/handler-QNs, unauflösbare
// navigate-Targets, screen-access) passierte früher den Dev-Server still und
// crashte erst den Prod-Pod im CrashLoopBackOff. Hier: ein Feature mit einem
// rowAction-navigate auf einen nie registrierten Screen — runDevApp muss
// SYNCHRON beim Boot werfen, bevor ein Port gebunden oder der codegen-Watcher
// gestartet wird (validateBoot läuft vor watchAndRegenerate).

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { runDevApp } from "../run-dev-app";

function unresolvableNavFeature() {
  return defineFeature("shop", (r) => {
    r.entity("product", createEntity({ fields: { name: createTextField() } }));
    r.screen({
      id: "product-list",
      type: "entityList",
      entity: "product",
      columns: ["name"],
      // "ghost-screen" wird nie via r.screen registriert → validateBoot wirft.
      rowActions: [{ kind: "navigate", id: "edit", label: "actions.edit", screen: "ghost-screen" }],
    });
  });
}

describe("runDevApp boot-validation (#359)", () => {
  test("unresolvable navigate-target throws at boot — dev/prod parity, no port bound", async () => {
    await expect(runDevApp({ features: [unresolvableNavFeature()] })).rejects.toThrow(
      /navigate-target "ghost-screen" does not resolve/,
    );
  });
});
