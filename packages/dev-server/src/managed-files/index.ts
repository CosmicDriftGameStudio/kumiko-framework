export {
  findPortCollisions,
  listAppPorts,
  type PortClaim,
  type PortCollision,
  parseStaticAppConfig,
  readStaticAppConfig,
  type ScannedApp,
  type StaticAppConfig,
  scanWorkspaceApps,
} from "@cosmicdrift/kumiko-guards/repo-manifest/app-ports";
export {
  type AppScriptsReport,
  checkAppScripts,
  KNOWN_EXTRA_APP_SCRIPTS,
  PREPARE_SCRIPT,
  STANDARD_APP_SCRIPTS,
  type StandardAppScript,
} from "./app-scripts.ts";
export {
  checkManagedFiles,
  isManagedDrift,
  type ManagedCheckResult,
  type ManagedFileReport,
  type ManagedFileState,
} from "./check.ts";
export {
  addManagedMarker,
  MANAGED_MARKER,
  readManagedMarker,
  stripManagedMarker,
} from "./marker.ts";
export {
  BIOME_PRESET,
  listManagedFiles,
  listManagedWarnings,
  type ManagedAppFacts,
  type ManagedAppInput,
  type ManagedFile,
  type ManagedTemplateFile,
  renderBiomePresetJson,
  renderManagedBunfig,
  renderManagedTemplates,
  renderTsconfigPresetJson,
  resolveManagedAppFacts,
  TSCONFIG_PRESET,
} from "./registry.ts";
export { type SyncAction, type SyncManagedOptions, syncManagedFiles } from "./sync.ts";
