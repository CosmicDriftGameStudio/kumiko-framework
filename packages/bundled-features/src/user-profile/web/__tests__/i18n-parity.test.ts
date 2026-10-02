import { describe, expect, test } from "bun:test";
import { createUserProfileFeature } from "../../feature.js";
import { defaultTranslations } from "../../i18n.js";

describe("user-profile server/client translation parity", () => {
  const clientEn = defaultTranslations["en"] ?? {};
  const serverEn = Object.entries(createUserProfileFeature().translations ?? {}).flatMap(
    ([key, localized]) => (localized["en"] === undefined ? [] : [[key, localized["en"]] as const]),
  );

  test("every server-registered key exists in the client bundle", () => {
    const missing = serverEn.filter(([key]) => clientEn[key] === undefined).map(([key]) => key);
    expect(missing).toEqual([]);
  });

  test("the server en default equals the client bundle value", () => {
    const drifted = serverEn
      .filter(([key, en]) => clientEn[key] !== en)
      .map(([key, en]) => ({ key, server: en, client: clientEn[key] }));
    expect(drifted).toEqual([]);
  });
});
