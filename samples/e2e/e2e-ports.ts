// Single source for Playwright webServer ports; framework configs import it, apps copy the number.
// App entries are the allocation their migration issues adopt; their live configs may still differ.
export const E2E_PORTS = {
  "framework/config-demo": 4173,
  "framework/ui-walkthrough": 4174,
  "framework/ui-walkthrough-puppeteer-service": 4198,
  "framework/showcase": 4175,
  "framework/renderer": 4176,
  "framework/marketing-demo": 4179,
  "framework/use-all-bundled": 4194,
  "framework/use-all-bundled-billing-gallery": 4196,
  "framework/use-all-bundled-puppeteer-service": 4197,
  "framework/use-all-bundled-fake-telegram": 4199,
  "framework/styleguide": 4187,
  "framework/workspaces": 4182,
  "framework/admin-console": 4183,
  "framework/hero-demos": 4290,
  "framework/testing": 4195,
  "publicstatus/e2e": 4178,
  "publicstatus/screenshots": 4184,
  "money-horse/screenshots": 4318,
  "money-horse/e2e": 4319,
  "solon/e2e": 4185,
  "solon/screenshots": 4186,
  "phronexsis/e2e": 4321,
  "phronexsis/screenshots": 4322,
  "show-pony/e2e": 4181,
  "show-pony/screenshots": 4193,
  "offlot-app/e2e": 4320,
  "offlot-app/screenshots": 4332,
} as const;

export type E2ePortKey = keyof typeof E2E_PORTS;
