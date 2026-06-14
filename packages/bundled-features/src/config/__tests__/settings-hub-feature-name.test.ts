import { describe, expect, test } from "bun:test";
import { SETTINGS_HUB_FEATURE } from "@cosmicdrift/kumiko-framework/engine";
import { CONFIG_FEATURE } from "../constants";

// Cross-package pin: buildAppSchema merges the generated Settings-Hub into the
// FeatureSchema named SETTINGS_HUB_FEATURE. The framework hard-codes that name
// because it cannot import bundled-features (dependency points the other way).
// This test lives where BOTH constants are visible — if the config feature is
// ever renamed, the hub would silently land in a phantom feature; this fails first.
describe("Settings-Hub feature-name pin", () => {
  test("framework's SETTINGS_HUB_FEATURE equals the config feature's name", () => {
    expect(SETTINGS_HUB_FEATURE).toBe(CONFIG_FEATURE);
  });
});
