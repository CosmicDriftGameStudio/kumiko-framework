export { expect } from "@playwright/test";
export { E2E_TIMEOUT_MS } from "../e2e-timeouts";
export {
  isRealProviderRun,
  REAL_PROVIDERS_ENV,
  requireRealProviders,
} from "../helpers/real-providers.ts";
export {
  apiCommand,
  apiQuery,
  apiWrite,
  CLIENT_IP_HEADER,
  clearSession,
  createHttpApi,
  csrfFetch,
  csrfHeaderFromCookies,
  enrollTotpViaApi,
  type LoginCredentials,
  type LoginViaApiOptions,
  loginViaApi,
  loginViaUi,
  syntheticClientIpFor,
  totpCode,
} from "./auth-kit";
export { boundaryGuardedTest } from "./boundary-guard";
export {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  E2E_WORKERS_ENV,
  KUMIKO_SECRETS_MASTER_KEY_V1,
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_TOKEN_ENV,
} from "./constants";
export {
  type AppE2eConfigInput,
  defineAppE2eConfig,
  type E2eProject,
  resolveE2eWorkers,
} from "./define-app-e2e-config";
export { type MailCaptureOptions, mailCapture } from "./mail-capture";
export {
  decodeHtmlAttribute,
  extractMailLink,
  extractMailLinkToken,
  mailLinks,
} from "./mail-links";
export { pinEnglishLocale } from "./pin-english-locale";
export { pollForRow, waitForProjection } from "./poll";
export {
  requireScreenshotDir,
  SCREENSHOT_DIR_ENV,
  screenshotSpecsIgnore,
} from "./screenshot-dir";
export {
  applyDefaultTheme,
  type CaptureFit,
  type CaptureScreenshotOptions,
  captureScreenshot,
  DEFAULT_THEMES,
  type DefaultThemeId,
  type FlatOptions,
  findIdenticalThemeScreenshots,
  type MatrixOptions,
  type PresentIdentity,
  runMatrix,
  runScreenshots,
  type Scenario,
  type ScenarioFixtures,
  type ThemeScreenshotDigest,
  trackInFlightRequests,
  validateScenarios,
} from "./screenshots";
export type { CapturedMail } from "./seed-contract";
export {
  type E2eSeededTenant,
  type E2eSeedTenantOptions,
  type SeedTenantFixture,
  test,
} from "./seeded-tenant-fixture";
