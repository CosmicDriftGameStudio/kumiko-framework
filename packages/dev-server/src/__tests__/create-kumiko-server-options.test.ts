// Option/error matrix for createKumikoServer — pins boot-time rejects
// that happen before Postgres/Redis wiring (normalizeEntries).

import { describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createKumikoServer } from "../create-kumiko-server";

const emptyFeature = defineFeature("prod-packaging-options-probe", () => {});

describe("createKumikoServer — option matrix", () => {
  test("clientEntry + clientEntries → mutually exclusive error", async () => {
    await expect(
      createKumikoServer({
        features: [emptyFeature],
        clientEntry: "src/client.tsx",
        clientEntries: [{ name: "admin", sourceFile: "src/client-admin.tsx" }],
        installSignalHandlers: false,
        port: 0,
      }),
    ).rejects.toThrow(/mutually exclusive/);
  });

  test("clientEntries without hostDispatch → error", async () => {
    await expect(
      createKumikoServer({
        features: [emptyFeature],
        clientEntries: [{ name: "admin", sourceFile: "src/client-admin.tsx" }],
        installSignalHandlers: false,
        port: 0,
      }),
    ).rejects.toThrow(/hostDispatch/);
  });
});
