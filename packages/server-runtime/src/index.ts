// Public API für den Kumiko-Production-Server-Boot. Symmetrisch zu
// runDevApp (kumiko-dev-server), aber ohne Dev-/Scaffold-/Codegen-
// Tooling (ts-morph) als Dependency — Prod-Apps ziehen so kein
// Dev-Tooling mehr in ihre node_modules.
export { type ComposeFeaturesOptions, composeFeatures } from "./compose-features";
export type {
  AccountUnlockSetup,
  EmailVerificationSetup,
  InviteSetup,
  PasswordResetSetup,
  ProdAppHandle,
  ProdSeedFn,
  RunProdAppAuthOptions,
  RunProdAppOptions,
  SignupSetup,
} from "./run-prod-app";
export { runProdApp } from "./run-prod-app";
export type { SecurityHeadersOption } from "./security-headers";
