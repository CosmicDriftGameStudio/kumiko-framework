// Public API für den Kumiko-Production-Server-Boot. Symmetrisch zu
// runDevApp (kumiko-dev-server), aber ohne Dev-/Scaffold-/Codegen-
// Tooling (ts-morph) als Dependency — Prod-Apps ziehen so kein
// Dev-Tooling mehr in ihre node_modules.

export {
  type BundledAssetDeclaration,
  type BundledAssetOptions,
  readBundledAsset,
  resolveBundledAsset,
} from "./bundled-assets.js";
export { type ComposeFeaturesOptions, composeFeatures } from "./compose-features.js";
export type { RunBootstrapOptions } from "./run-bootstrap.js";
export { runBootstrap } from "./run-bootstrap.js";
export type {
  AccountUnlockSetup,
  EmailVerificationSetup,
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
} from "./run-prod-app.js";
export { requireEnv, runProdApp } from "./run-prod-app.js";
export type {
  RunWorkerAppOptions,
  WorkerAppHandle,
  WorkerWireDeps,
} from "./run-worker-app.js";
export { runWorkerApp } from "./run-worker-app.js";
export type { SecurityHeadersOption } from "./security-headers.js";
