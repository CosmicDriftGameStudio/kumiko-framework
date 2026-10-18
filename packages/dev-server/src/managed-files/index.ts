export { listAppPorts } from "@cosmicdrift/kumiko-framework/config";
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
  findPortCollisions,
  type PortClaim,
  type PortCollision,
  type ScannedApp,
  scanWorkspaceApps,
} from "./port-registry.ts";
export {
  BIOME_PRESET,
  listManagedFiles,
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
export {
  parseStaticAppConfig,
  readStaticAppConfig,
  type StaticAppConfig,
} from "./static-app-config.ts";
export { type SyncAction, type SyncManagedOptions, syncManagedFiles } from "./sync.ts";
