// Public API für den Kumiko-Production-Server-Boot. Symmetrisch zu
// runDevApp (kumiko-dev-server), aber ohne Dev-/Scaffold-/Codegen-
// Tooling (ts-morph) als Dependency — Prod-Apps ziehen so kein
// Dev-Tooling mehr in ihre node_modules.

export { type BillingBootOption, resolveBillingOption } from "./boot-options/billing-option.ts";
export type {
  DemoAccountRole,
  DemoModeNotice,
  DemoModeOption,
} from "./boot-options/demo-mode.ts";
export {
  buildDemoModeRoute,
  withDemoReadOnlyFetch,
} from "./boot-options/demo-mode.ts";
export type {
  FileStorageBootOption,
  FileStorageProviderName,
} from "./boot-options/file-storage-option.ts";
export type { KmsMode } from "./boot-options/kms-mode.ts";
export type { MailBootOption } from "./boot-options/mail-option.ts";
export type { SignalsOption } from "./boot-options/process-signals.ts";
export type { ProdSeedsConfig, ProdSeedTenant } from "./boot-options/seed-shortcuts.ts";
export {
  type BundledAssetDeclaration,
  type BundledAssetOptions,
  readBundledAsset,
  resolveBundledAsset,
} from "./bundled-assets.ts";
export { type ComposeFeaturesOptions, composeFeatures } from "./compose-features.ts";
export type { RateLimitOption } from "./rate-limit-defaults.ts";
export type { RunBootstrapOptions } from "./run-bootstrap.ts";
export { runBootstrap } from "./run-bootstrap.ts";
export type {
  AccountUnlockSetup,
  EmailVerificationSetup,
  HostDispatchFn,
  InviteSetup,
  PageHeadMeta,
  PageHeadResolver,
  PageHeadSystemQuery,
  PasswordResetSetup,
  ProdAppHandle,
  ProdSeedFn,
  RunProdAppAuthOptions,
  RunProdAppOptions,
  SignupSetup,
} from "./run-prod-app.ts";
export { parseRunMode, requireEnv, runProdApp } from "./run-prod-app.ts";
export type {
  RunWorkerAppOptions,
  WorkerAppHandle,
  WorkerWireDeps,
} from "./run-worker-app.ts";
export { runWorkerApp } from "./run-worker-app.ts";
export type { CspExtension, CspOption, SecurityHeadersOption } from "./security-headers.ts";
export { makeSeedCreateFileRef, type SeedCreateFileRef } from "./seed-dispatcher.ts";
