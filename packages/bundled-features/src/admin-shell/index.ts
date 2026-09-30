export {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
  PLATFORM_OVERVIEW_SCREEN_ID,
  TENANT_OVERVIEW_SCREEN_ID,
} from "./constants.js";
export { type CreateAdminShellOptions, createAdminShellFeature } from "./feature.js";
export { ADMIN_SHELL_I18N } from "./i18n.js";
export {
  isOverviewQueryAllowed,
  type OverviewWorkspaceKind,
  overviewAllowedQueries,
  PLATFORM_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "./overview-allowlist.js";
