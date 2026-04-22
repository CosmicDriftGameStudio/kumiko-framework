import { defineFeature, type FeatureDefinition } from "@kumiko/framework/engine";
import { logQuery } from "./handlers/log.query";
import { preferencesQuery } from "./handlers/preferences.query";
import { setPreferenceWrite } from "./handlers/set-preference.write";

export function createDeliveryFeature(): FeatureDefinition {
  return defineFeature("delivery", (r) => {
    r.systemScope();

    // Extension points: channels and renderers register as features
    r.extendsRegistrar("deliveryChannel", {
      onRegister: () => {},
    });
    r.extendsRegistrar("notificationRenderer", {
      onRegister: () => {},
    });

    const handlers = {
      setPreference: r.writeHandler(setPreferenceWrite),
    };

    const queries = {
      log: r.queryHandler(logQuery),
      preferences: r.queryHandler(preferencesQuery),
    };

    return { handlers, queries };
  });
}
