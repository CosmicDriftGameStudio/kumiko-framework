// Public API for the Kumiko development server, with two layers:
//
//   - createKumikoServer (low-level)
//     Bun.serve wrapper that provides the client bundle, /styles.css,
//     AppSchema injection, SSE reload, and auto-minted JWTs. Accepts
//     features + clientEntry directly without automatic auth wiring. Use it
//     for unusual auth setups (alternative Membership query, custom rate
//     limiter, or custom login routes).
//
//   - runDevApp (high-level)
//     Automatically adds the standard features (config/user/tenant/
//     auth-email-password) when `auth` is set, wires the login routes and
//     error map, and calls seedAdminGuarded in onAfterSetup. The default for
//     sample apps and showcases: 5–10 lines of bootstrap instead of 50.

export {
  type ComposeFeaturesOptions,
  composeFeatures,
} from "@cosmicdrift/kumiko-server-runtime/compose-features";
// The build toolchain (buildProdBundle, Bun.build, Tailwind pipeline, ts-morph)
// lives in the subpath export `@cosmicdrift/kumiko-dev-server/build`. This keeps
// the Bun toolchain bundle out of production imports from the main barrel (for
// example, when drizzle-kit loads the app config under Node).
export {
  type AuthStackOptions,
  composeAuthStack,
  composeFileStack,
  composeGdprStack,
  composeIdentityStack,
  composeMailStack,
  composeOpsStack,
  composePagesStack,
  composeRendererStack,
  composeSaasStack,
  composeSecurityStack,
  composeUserDataRightsStack,
  type FileProviderKind,
  type FileStackOptions,
  type GdprStackOptions,
  type GdprStackOrder,
  type IdentityStackOptions,
  type MailStackOptions,
  type MailTransportKind,
  type OpsStackOptions,
  type PagesStackOptions,
  type SaasStackBilling,
  type SaasStackOptions,
  type SecurityStackOptions,
  stackFeatureNames,
  type UserDataRightsStackOptions,
} from "./compose-stacks.ts";
export {
  type CreateKumikoServerOptions,
  createKumikoServer,
  type DevHostDispatch,
  type DevHostDispatchResult,
  type KumikoServerHandle,
} from "./create-kumiko-server.ts";
export { PROD_BUNDLES_ENV } from "./create-kumiko-server-client-bundles.ts";
export { resolveStylesheet, STYLESHEET_WATCH_ENV } from "./create-kumiko-server-stylesheet.ts";
export { type FrameworkCoreEnv, frameworkCoreEnvSchema } from "./env-schema.ts";
export type {
  AuthoringStyle,
  BuildFewShotCorpusOptions,
  CorpusWarning,
  FewShotCorpus,
  FewShotEntry,
} from "./few-shot-corpus.ts";
export { buildFewShotCorpus, pathToId } from "./few-shot-corpus.ts";
export { resolveFrameworkVersion } from "./framework-version.ts";
export { type ToDevHostDispatchOptions, toDevHostDispatch } from "./host-dispatch-adapter.ts";
export type { CliOutput, RunInitDeployCliOptions } from "./init-deploy-cli.ts";
export { runInitDeployCli } from "./init-deploy-cli.ts";
export type { RunDevAppAuthOptions, RunDevAppOptions, SeedFn } from "./run-dev-app.ts";
export { runDevApp } from "./run-dev-app.ts";
export type {
  ScaffoldAppOptions,
  ScaffoldAppResult,
  ScaffoldFeatureEntry,
} from "./scaffold-app.ts";
export { SCAFFOLD_BIOME_VERSION, scaffoldApp } from "./scaffold-app.ts";
export type {
  ScaffoldAppFeatureOptions,
  ScaffoldAppFeatureResult,
} from "./scaffold-app-feature.ts";
export { runConfigPathForApp, scaffoldAppFeature } from "./scaffold-app-feature.ts";
export { SCAFFOLD_STARTERS, type ScaffoldStarter } from "./scaffold-blank-starter.ts";
export type {
  CheckDeployDriftResult,
  DeployDriftEntry,
  RenderDeployFilesOptions,
  RenderDeployFilesResult,
  RenderedDeployFile,
  ScaffoldDeployDetected,
  ScaffoldDeployOptions,
  ScaffoldDeployResult,
  ScaffoldedFile,
} from "./scaffold-deploy.ts";
export { checkDeployDrift, renderDeployFiles, scaffoldDeploy } from "./scaffold-deploy.ts";
export type { ScaffoldFeatureOptions, ScaffoldFeatureResult } from "./scaffold-feature.ts";
export { scaffoldFeature } from "./scaffold-feature.ts";
export {
  type SetupTestStackFromFeaturesOptions,
  setupTestStackFromFeatures,
  type TestStackPreset,
} from "./setup-test-stack-from-features.ts";
export { renderWelcomeBanner, type WelcomeBannerInput } from "./welcome-banner.ts";
