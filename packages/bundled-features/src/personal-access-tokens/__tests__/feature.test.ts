import { describe, expect, test } from "bun:test";
import { PAT_TOKEN_PREFIX } from "@cosmicdrift/kumiko-framework/api";
import { EXT_TOKEN_VERIFIER } from "../../auth-foundation";
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

describe("createPersonalAccessTokensFeature — tokenVerifier registration (#1369)", () => {
  test('registers via r.useExtension(EXT_TOKEN_VERIFIER, "pat", ...) instead of a patResolver field', () => {
    const feature = createPersonalAccessTokensFeature({ scopes: {} });
    expect(feature.extensionUsages).toHaveLength(1);
    const [usage] = feature.extensionUsages;
    expect(usage?.extensionName).toBe(EXT_TOKEN_VERIFIER);
    expect(usage?.entityName).toBe("pat");
    expect(usage?.options).toMatchObject({ shape: { kind: "prefix", prefix: PAT_TOKEN_PREFIX } });
  });

  test("requires auth-foundation (owner of EXT_TOKEN_VERIFIER)", () => {
    const feature = createPersonalAccessTokensFeature({ scopes: {} });
    expect(feature.requires).toContain("auth-foundation");
  });
});
