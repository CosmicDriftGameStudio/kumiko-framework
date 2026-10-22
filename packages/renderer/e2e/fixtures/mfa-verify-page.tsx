// Standalone MfaVerifyScreen mount for Playwright; API mocked via page.route
// in the spec. Side-effect module: import only from the /mfa-verify branch in
// client.tsx.

import {
  emailPasswordClient,
  SessionProvider,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password/web";
import { authMfaClient, MfaVerifyScreen } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/web";
import { localeDeClient } from "@cosmicdrift/kumiko-locale-de/web";
import { createStaticLocaleResolver } from "@cosmicdrift/kumiko-renderer";
import { createPublicSurface } from "@cosmicdrift/kumiko-renderer/web";

const screen = (
  <SessionProvider>
    <MfaVerifyScreen challengeToken="e2e-challenge" onCancel={() => undefined} />
  </SessionProvider>
);

createPublicSurface({
  locale: createStaticLocaleResolver({ locale: "de" }),
  // localeDeClient first: bundle lookup is first-match, and the feature bundles carry "en" fallbacks.
  clientFeatures: [localeDeClient(), emailPasswordClient(), authMfaClient()],
  routes: [{ path: "/mfa-verify", component: screen }],
  fallback: screen,
});
