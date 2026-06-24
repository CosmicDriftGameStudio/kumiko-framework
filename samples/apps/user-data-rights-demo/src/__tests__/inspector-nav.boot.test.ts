import { describe, expect, test } from "bun:test";
import { createSessionsFeature } from "@cosmicdrift/kumiko-bundled-features/sessions";
import { composeFeatures } from "@cosmicdrift/kumiko-dev-server";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { todosFeature } from "../feature";
import { APP_FEATURES } from "../run-config";

// Wire-proof: the demo app opts into the read-only GDPR inspector screens that
// ship (inert) in user-data-rights by navigating them. validateBoot throws if a
// nav references a screen that does not resolve — so a clean boot proves the
// cross-feature opt-in mount works (todos navs a user-data-rights screen with
// no import or coupling, only the screen QN).
//
// composeFeatures({ includeBundled: true }) mirrors runDevApp's auto-mount of
// config/user/tenant/auth; sessions is added explicitly here (the live app
// pulls it via its auth config), since user-data-rights usesApi sessions.

describe("user-data-rights-demo inspector nav wire-proof", () => {
  const composed = composeFeatures([...APP_FEATURES, createSessionsFeature()], {
    includeBundled: true,
  });

  test("the app boot-validates with the inspector navs wired", () => {
    expect(() => validateBoot(composed)).not.toThrow();
  });

  test("the app navs the bundled inspector screens (opt-in)", () => {
    const screens = Object.values(todosFeature.navs).map((n) => n.screen);
    expect(screens).toEqual(
      expect.arrayContaining([
        "user-data-rights:screen:export-job-list",
        "user-data-rights:screen:download-attempt-list",
      ]),
    );
  });
});
