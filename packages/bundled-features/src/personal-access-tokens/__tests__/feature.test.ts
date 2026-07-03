import { describe, expect, test } from "bun:test";
import { createPersonalAccessTokensFeature } from "../feature";

describe("createPersonalAccessTokensFeature toggleable-option (tier-gating)", () => {
  test("without toggleable: feature is always-on (toggleableDefault undefined)", () => {
    expect(createPersonalAccessTokensFeature({ scopes: {} }).toggleableDefault).toBeUndefined();
  });

  test("toggleable:{default:false} makes the feature tier-gatable, fail-closed", () => {
    const feature = createPersonalAccessTokensFeature({
      scopes: {},
      toggleable: { default: false },
    });
    expect(feature.toggleableDefault).toBe(false);
  });

  test("toggleable:{default:true} declares toggleable, enabled-by-default", () => {
    const feature = createPersonalAccessTokensFeature({
      scopes: {},
      toggleable: { default: true },
    });
    expect(feature.toggleableDefault).toBe(true);
  });
});
