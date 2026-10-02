// runDevApp muss denselben Boot-Validator wie runProdApp ausführen (#359):
// eine ganze Fehlerklasse (unqualifizierte nav-/handler-QNs, unauflösbare
// navigate-Targets, screen-access) passierte früher den Dev-Server still und
// crashte erst den Prod-Pod im CrashLoopBackOff. Hier: ein Feature mit einem
// rowAction-navigate auf einen nie registrierten Screen — runDevApp muss
// SYNCHRON beim Boot werfen, bevor ein Port gebunden oder der codegen-Watcher
// gestartet wird (validateBoot läuft vor watchAndRegenerate).

import { describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { runDevApp } from "../run-dev-app.js";

function unresolvableNavFeature() {
  return defineFeature("shop", (r) => {
    r.entity(
      "product",
      createEntity({
        fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
      }),
    );
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

function fileFieldFeature() {
  return defineFeature("docs", (r) => {
    r.entity(
      "doc",
      createEntity({ table: "dev_boot_docs", fields: { contract: { type: "file" } } }),
    );
  });
}

describe("runDevApp validateBootOptions", () => {
  const FILE_STORAGE_PROVIDER = "FILE_STORAGE_PROVIDER";

  test("validateBootOptions.env reaches validateBoot (a file field needs a provider in THAT env)", async () => {
    const saved = process.env[FILE_STORAGE_PROVIDER];
    // process.env satisfies the gate, so only the option's own (empty) env can make it throw.
    process.env[FILE_STORAGE_PROVIDER] = "local";
    try {
      await expect(
        runDevApp({
          features: [fileFieldFeature()],
          port: 0,
          validateBootOptions: { env: {} },
        }),
      ).rejects.toThrow(/FILE_STORAGE_PROVIDER.*required/);
    } finally {
      if (saved === undefined) delete process.env[FILE_STORAGE_PROVIDER];
      else process.env[FILE_STORAGE_PROVIDER] = saved;
    }
  });
});

describe("runDevApp boot-validation (#359)", () => {
  test("unresolvable navigate-target throws at boot — dev/prod parity, no port bound", async () => {
    await expect(runDevApp({ features: [unresolvableNavFeature()] })).rejects.toThrow(
      /navigate-target "ghost-screen" does not resolve/,
    );
  });
});
