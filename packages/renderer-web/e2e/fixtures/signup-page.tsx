// Standalone SignupScreen mount for Playwright — real Chromium +
// createPublicSurface + auth i18n; API mocked via page.route in the spec.
//
// Side-effect module: import only from the /signup branch in client.tsx.
// Top-level mount keeps Bun from DCE'ing the auth graph when it constant-
// folds `window.location.pathname` during the e2e bundle.

import {
  emailPasswordClient,
  SignupScreen,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { createStaticLocaleResolver } from "@cosmicdrift/kumiko-renderer";
import { createPublicSurface } from "@cosmicdrift/kumiko-renderer-web";

createPublicSurface({
  locale: createStaticLocaleResolver({ locale: "de" }),
  clientFeatures: [emailPasswordClient()],
  routes: [{ path: "/signup", component: <SignupScreen loginHref="/login" /> }],
  fallback: <SignupScreen loginHref="/login" />,
});
