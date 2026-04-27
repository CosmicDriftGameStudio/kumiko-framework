// Build-Toolchain Public-API. Eigener Sub-Path-Export `@kumiko/dev-server/build`
// damit der Main-Barrel kein Bun-Toolchain-Bundle in Production-Reads zieht
// (z.B. wenn drizzle-kit die App-Config unter Node lädt).

export {
  ASSETS_DIR,
  type BuildManifest,
  type BuildProdBundleOptions,
  type BuildResult,
  buildProdBundle,
  discoverClientEntry,
  discoverHtmlTemplate,
  formatBuildResult,
  injectAssetTags,
} from "./build-prod-bundle";

export {
  type BuildServerBundleEntry,
  type BuildServerBundleOptions,
  type BuildServerBundleResult,
  buildServerBundle,
  discoverMigrationHooks,
  discoverServerEntry,
  formatServerBuildResult,
} from "./build-server-bundle";
