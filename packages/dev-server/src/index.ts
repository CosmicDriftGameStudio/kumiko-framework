// Public API für den Kumiko-Dev-Server. Zwei Schichten:
//
//   - createKumikoServer (low-level)
//     Bun.serve-Wrapper der Client-Bundle, /styles.css, AppSchema-
//     Injection, SSE-Reload und einen Auto-Mint-JWT-Modus liefert. Nimmt
//     features + clientEntry direkt an, kein Auth-Auto-Wiring. Wer
//     einen ungewöhnlichen Auth-Setup braucht (alternative Membership-
//     Query, eigener Rate-Limiter, custom Login-Routes) geht hier rein.
//
//   - runDevApp (high-level)
//     Mischt die Standard-Features (config/user/tenant/auth-email-
//     password) automatisch dazu wenn `auth` gesetzt ist, wired die
//     Login-Routes + Error-Map, ruft seedAdmin im onAfterSetup. Default
//     für Sample-Apps und Showcases — 5-10 Zeilen Bootstrap statt 50.

// Build-Toolchain (buildProdBundle, Bun.build, Tailwind-Pipeline, ts-morph) lebt
// im Sub-Path-Export `@cosmicdrift/kumiko-dev-server/build`. Damit zieht der Main-Barrel
// kein Bun-Toolchain-Bundle mehr in Production-Reads (z.B. wenn drizzle-kit
// die App-Config unter Node lädt).
export {
  type CodegenOptions,
  type CodegenResult,
  runCodegen,
  type ScannedEvent,
  type ScanWarning,
  scanEvents,
} from "./codegen";
export { type ComposeFeaturesOptions, composeFeatures } from "./compose-features";
export {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type KumikoServerHandle,
  resolveStylesheet,
} from "./create-kumiko-server";
export { type FrameworkCoreEnv, frameworkCoreEnvSchema } from "./env-schema";
export type {
  AuthoringStyle,
  BuildFewShotCorpusOptions,
  CorpusWarning,
  FewShotCorpus,
  FewShotEntry,
} from "./few-shot-corpus";
export { buildFewShotCorpus, pathToId } from "./few-shot-corpus";
export type { RunDevAppAuthOptions, RunDevAppOptions, SeedFn } from "./run-dev-app";
export { runDevApp } from "./run-dev-app";
export type {
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
export type {
  ScaffoldAppOptions,
  ScaffoldAppResult,
  ScaffoldFeatureEntry,
} from "./scaffold-app";
export { scaffoldApp } from "./scaffold-app";
export type {
  ScaffoldAppFeatureOptions,
  ScaffoldAppFeatureResult,
} from "./scaffold-app-feature";
export { runConfigPathForApp, scaffoldAppFeature } from "./scaffold-app-feature";
export type {
  ScaffoldDeployOptions,
  ScaffoldDeployResult,
  ScaffoldedFile,
} from "./scaffold-deploy";
export { scaffoldDeploy } from "./scaffold-deploy";
export type { ScaffoldFeatureOptions, ScaffoldFeatureResult } from "./scaffold-feature";
export { scaffoldFeature } from "./scaffold-feature";
export { renderWelcomeBanner, type WelcomeBannerInput } from "./welcome-banner";
