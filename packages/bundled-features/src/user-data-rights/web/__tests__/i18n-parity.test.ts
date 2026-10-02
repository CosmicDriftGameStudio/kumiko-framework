import { describe, expect, test } from "bun:test";
import { createUserDataRightsFeature } from "../../feature.js";
import { defaultTranslations } from "../i18n.js";

const PRIVACY_CENTER_PREFIX = "userDataRights.privacyCenter.";

describe("user-data-rights server/client translation parity", () => {
  const clientEn = defaultTranslations["en"] ?? {};
  const serverEn = Object.entries(createUserDataRightsFeature().translations ?? {}).flatMap(
    ([key, localized]) => (localized["en"] === undefined ? [] : [[key, localized["en"]] as const]),
  );

  test("every privacy-center key registered server-side exists in the client bundle", () => {
    const missing = serverEn
      .filter(([key]) => key.startsWith(PRIVACY_CENTER_PREFIX))
      .filter(([key]) => clientEn[key] === undefined)
      .map(([key]) => key);
    expect(missing).toEqual([]);
  });

  test("the server en default equals the client bundle value for every shared key", () => {
    const drifted = serverEn
      .filter(([key, en]) => clientEn[key] !== undefined && clientEn[key] !== en)
      .map(([key, en]) => ({ key, server: en, client: clientEn[key] }));
    expect(drifted).toEqual([]);
  });
});
