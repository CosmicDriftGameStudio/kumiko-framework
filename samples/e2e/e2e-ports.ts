// Single source for Playwright webServer ports; framework configs import it, apps copy the number.
// App entries are the allocation their migration issues adopt; their live configs may still differ.
export const E2E_PORTS = {
  "framework/config-demo": 4173,
  "framework/ui-walkthrough": 4174,
  "framework/showcase": 4175,
  "framework/renderer-web": 4176,
  "framework/marketing-demo": 4179,
  "framework/use-all-bundled": 4194,
  "framework/styleguide": 4187,
  "framework/workspaces": 4182,
  "framework/admin-console": 4183,
  "framework/recipe-wizard-form": 4188,
  "framework/recipe-writeform-section": 4189,
  "framework/recipe-record-detail-layout": 4190,
  "framework/hero-demos": 4290,
  "kumiko-studio/e2e": 4191,
  "kumiko-studio/screenshots": 4192,
  "publicstatus/e2e": 4178,
  "publicstatus/screenshots": 4184,
  "money-horse/screenshots": 4318,
  "money-horse/e2e": 4319,
  "solon/e2e": 4185,
  "phronexsis/e2e": 4321,
  "phronexsis/screenshots": 4322,
  "show-pony/e2e": 4181,
  "show-pony/screenshots": 4193,
  "offlot-app/e2e": 4320,
  "offlot-app/screenshots": 4332,
} as const;

export type E2ePortKey = keyof typeof E2E_PORTS;
