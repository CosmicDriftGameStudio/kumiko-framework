import { describe, expect, test } from "bun:test";
import { PAT_TOKEN_PREFIX } from "@cosmicdrift/kumiko-framework/api";
import { fieldOptionLabelKey } from "@cosmicdrift/kumiko-headless";
import { EXT_TOKEN_VERIFIER } from "../../auth-foundation";
import { PAT_MINT_SCREEN_ID, PAT_SCREEN_ID, PatHandlers, PatQueries } from "../constants";
import { createPersonalAccessTokensFeature } from "../feature";
import { patScopeOptionTranslations } from "../i18n";
import { expandScopes, type PatScopeConfig, parseGrant } from "../scopes";
import { patGrantOptions } from "../screens";

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

describe("createPersonalAccessTokensFeature — declarative screens (fw#2548 Teil B)", () => {
  test('registers no screen of type "custom"', () => {
    const feature = createPersonalAccessTokensFeature({ scopes: {} });
    const screens = Object.values(feature.screens);
    expect(screens.length).toBeGreaterThan(0);
    expect(screens.some((screen) => screen.type === "custom")).toBe(false);
  });

  test("list screen is a projectionList on PatQueries.mine with a revoke rowAction", () => {
    const feature = createPersonalAccessTokensFeature({ scopes: {} });
    const list = feature.screens[PAT_SCREEN_ID];
    expect(list?.type).toBe("projectionList");
    if (list?.type !== "projectionList") throw new Error("expected a projectionList screen");
    expect(list.query).toBe(PatQueries.mine);
    const revoke = list.rowActions?.find((action) => action.id === "revoke");
    expect(revoke).toMatchObject({ handler: PatHandlers.revoke, kind: "writeHandler" });
  });

  test('mint screen is a secretMint on PatHandlers.create whose reveal.fields is exactly ["token"]', () => {
    const feature = createPersonalAccessTokensFeature({ scopes: {} });
    const mint = feature.screens[PAT_MINT_SCREEN_ID];
    expect(mint?.type).toBe("secretMint");
    if (mint?.type !== "secretMint") throw new Error("expected a secretMint screen");
    expect(mint.handler).toBe(PatHandlers.create);
    expect(mint.reveal.fields.map((field) => field.field)).toEqual(["token"]);
  });
});

describe("patGrantOptions (fw#2548 Teil B)", () => {
  test("a read-only domain yields only <domain>:read", () => {
    const scopes: PatScopeConfig = { billing: { label: "Billing", read: ["billing:query:*"] } };
    expect(patGrantOptions(scopes)).toEqual(["billing:read"]);
  });

  test("a domain with a non-empty write set additionally yields <domain>:write", () => {
    const scopes: PatScopeConfig = {
      ledger: { label: "Ledger", read: ["ledger:query:*"], write: ["ledger:write:*"] },
    };
    expect(patGrantOptions(scopes)).toEqual(["ledger:read", "ledger:write"]);
  });

  test("every generated grant string round-trips through parseGrant/expandScopes", () => {
    const scopes: PatScopeConfig = {
      billing: { label: "Billing", read: ["billing:query:*"] },
      ledger: { label: "Ledger", read: ["ledger:query:*"], write: ["ledger:write:*"] },
    };
    for (const grant of patGrantOptions(scopes)) {
      const parsed = parseGrant(grant);
      expect(parsed).not.toBeNull();
      expect(scopes[parsed?.domain ?? ""]).toBeDefined();
      expect(expandScopes(scopes, [grant]).length).toBeGreaterThan(0);
    }
    // A read-level grant must not leak the domain's write QNs.
    expect(expandScopes(scopes, ["ledger:read"])).toEqual(["ledger:query:*"]);
    expect(expandScopes(scopes, ["ledger:write"])).toEqual(
      expect.arrayContaining(["ledger:query:*", "ledger:write:*"]),
    );
  });
});

describe("patScopeOptionTranslations (fw#2548 Teil B)", () => {
  test("option-label keys match the renderer's actual resolution convention (fieldOptionLabelKey)", () => {
    const scopes: PatScopeConfig = {
      billing: { label: "Billing", read: ["billing:query:*"], write: ["billing:write:*"] },
    };
    const translations = patScopeOptionTranslations(scopes);
    // fieldOptionLabelKey is the exact function the mint form's multiSelect
    // uses at render time (buildOptionLabels, headless/view-model/edit.ts) —
    // building the same key here and looking it up in `translations` proves
    // the label actually reaches the renderer instead of silently falling
    // back to the raw grant string.
    const readKey = fieldOptionLabelKey(
      "personal-access-tokens",
      "__action-form__",
      "scopes",
      "billing:read",
    );
    const writeKey = fieldOptionLabelKey(
      "personal-access-tokens",
      "__action-form__",
      "scopes",
      "billing:write",
    );
    expect(translations[readKey]?.en).toBe("Billing (read)");
    expect(translations[writeKey]?.en).toBe("Billing (read & write)");
  });
});
