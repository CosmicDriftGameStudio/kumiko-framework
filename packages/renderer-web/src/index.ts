// Public entry für @kumiko/renderer-web. Re-exportiert die shared-
// API aus @kumiko/renderer damit Samples nur ein Paket importieren
// müssen, und fügt die Web-spezifischen Helpers dazu: createKumikoApp
// (react-dom-bootstrap), defaultPrimitives (HTML), useBrowserNavApi
// (window.history), createEventSourceLiveEvents, KumikoLink.

// --- Shared re-exports (Components, Hooks, Types, Contexts) ---
export type {
  AppPrimitives,
  AppTokens,
  BannerProps,
  ButtonProps,
  ColorTokens,
  CorePrimitives,
  CoreTokens,
  DataTableProps,
  DispatcherProviderProps,
  FeatureSchema,
  FieldProps,
  FormProps,
  GridCellProps,
  GridProps,
  InputProps,
  KumikoScreenProps,
  LiveEvent,
  LiveEventSubscriber,
  LiveEventsProviderProps,
  LocaleProviderProps,
  NavApi,
  NavProviderProps,
  NavRoute,
  NavTarget,
  PrimitivesProviderProps,
  PrimitivesRegistry,
  RadiusTokens,
  RenderEditProps,
  RenderFieldProps,
  RenderListProps,
  SectionProps,
  TextProps,
  ThemeMode,
  Tokens,
  TokensApi,
  TokensProviderProps,
  TranslationBundle,
  TranslationsByLocale,
  UseFormOptions,
  UseFormResult,
  UseQueryOptions,
  UseQueryResult,
} from "@kumiko/renderer";
export {
  createStaticLocaleResolver,
  cssVarTokens,
  DispatcherProvider,
  formatPath,
  KumikoScreen,
  LiveEventsProvider,
  LocaleProvider,
  NavProvider,
  PrimitivesProvider,
  parsePath,
  qualifyScreenId,
  RenderEdit,
  RenderField,
  RenderList,
  TokensProvider,
  useDispatcher,
  useDispatcherStatus,
  useForm,
  useLiveEvents,
  useLocale,
  useNav,
  usePrimitives,
  useQuery,
  useStore,
  useStoreSelector,
  useTokenController,
  useTokens,
  useTranslation,
} from "@kumiko/renderer";
// --- Web-platform specifics ---
export { createBrowserLocaleResolver } from "./app/browser-locale";
export type { ClientFeatureDefinition } from "./app/client-plugin";
export type { CreateKumikoAppOptions } from "./app/create-app";
export { createKumikoApp } from "./app/create-app";
export type { KumikoLinkProps } from "./app/nav";
export { KumikoLink, useBrowserNavApi } from "./app/nav";
export type { AppLayoutProps } from "./layout/app-layout";
export { AppLayout } from "./layout/app-layout";
export type { DefaultAppShellProps } from "./layout/default-app-shell";
export { DefaultAppShell } from "./layout/default-app-shell";
export type { LanguageSwitcherProps, LocaleOption } from "./layout/language-switcher";
export { LanguageSwitcher } from "./layout/language-switcher";
export type { NavTreeProps } from "./layout/nav-tree";
export { buildNavRegistrySlice, NavTree } from "./layout/nav-tree";
export type { SidebarProps } from "./layout/sidebar";
export { Sidebar } from "./layout/sidebar";
export type { ThemeToggleProps } from "./layout/theme-toggle";
export type { WorkspaceShellProps, WorkspaceShellUser } from "./layout/workspace-shell";
export { filterByAccess, resolveDefaultId, WorkspaceShell } from "./layout/workspace-shell";
export type { WorkspaceSwitcherProps } from "./layout/workspace-switcher";
export { WorkspaceSwitcher } from "./layout/workspace-switcher";
export { ThemeToggle } from "./layout/theme-toggle";
export type { TopbarProps } from "./layout/topbar";
export { Topbar } from "./layout/topbar";
export { cn } from "./lib/cn";
export type { UseDropdownMenuOptions } from "./lib/use-dropdown-menu";
export { useDropdownMenu } from "./lib/use-dropdown-menu";
export { defaultPrimitives } from "./primitives";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events";
export { createEventSourceLiveEvents } from "./sse/live-events";
export {
  applyTokensToCssVars,
  defaultTokens,
  lightTokens,
  useBrowserTokensApi,
} from "./tokens";
