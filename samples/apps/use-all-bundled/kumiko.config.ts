// Feature list for `kumiko agent lint`. Mirrors what src/app/server.ts mounts,
// including the config/user/tenant/auth foundation composeFeatures prepends in
// auth-mode — without it the lint would miss the four auto-mounted features.

import {
  buildComposeAuthOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { notesFeature } from "./src/app/notes-feature";
import { appScreensFeature } from "./src/app/screens-feature";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "./src/run-config";

export default {
  features: composeFeatures([...APP_FEATURES, appScreensFeature, notesFeature], {
    includeBundled: true,
    ...(buildComposeAuthOptions(AUTH_COMPOSE_OPTIONS) !== undefined && {
      authOptions: buildComposeAuthOptions(AUTH_COMPOSE_OPTIONS),
    }),
  }),
};
