// Build-toolchain public API. The dedicated subpath export `@cosmicdrift/kumiko-dev-server/build`
// keeps the main barrel from pulling the Bun toolchain bundle into production reads
// (for example, when drizzle-kit loads the app config under Node).

export {
  ASSETS_DIR,
  type BuildManifest,
  type BuildProdBundleOptions,
  type BuildResult,
  buildProdBundle,
  type ClientEntry,
  type ClientEntryDeclaration,
  discoverHtmlTemplate,
  formatBuildResult,
  injectAssetTags,
  readClientEntriesConfig,
  resolveClientEntries,
} from "@cosmicdrift/kumiko-server-runtime/build-prod-bundle";

export {
  type BuildServerBundleEntry,
  type BuildServerBundleOptions,
  type BuildServerBundleResult,
  buildServerBundle,
  discoverServerEntry,
  formatServerBuildResult,
  type KumikoBuildArgs,
  parseKumikoBuildArgs,
  readExtraRuntimeExternals,
} from "./build-server-bundle.ts";

export {
  type ServerLockfileResult,
  type WriteServerLockfileOptions,
  writeServerLockfile,
} from "./write-server-lockfile.ts";
