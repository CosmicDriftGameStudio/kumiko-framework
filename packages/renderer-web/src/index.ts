// Public entry für @cosmicdrift/kumiko-renderer-web. Re-exportiert die shared-
// API aus @cosmicdrift/kumiko-renderer damit Samples nur ein Paket importieren
// müssen, und fügt die Web-spezifischen Helpers dazu: createKumikoApp
// (react-dom-bootstrap), defaultPrimitives (HTML), useBrowserNavApi
// (window.history), createEventSourceLiveEvents, KumikoLink.

// --- Shared re-exports (Components, Hooks, Types, Contexts) ---
export type {
  AppPrimitives,
  AppSchema,
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
  HeadingProps,
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
  WorkspaceSchema,
} from "@cosmicdrift/kumiko-renderer";
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
} from "@cosmicdrift/kumiko-renderer";
// --- Web-platform specifics ---
export { createBrowserLocaleResolver } from "./app/browser-locale";
export type { ClientFeatureDefinition } from "./app/client-plugin";
export type { CreateKumikoAppOptions } from "./app/create-app";
export { createKumikoApp } from "./app/create-app";
export type { CreatePublicSurfaceOptions, PublicRoute } from "./app/create-public-surface";
export { createPublicSurface } from "./app/create-public-surface";
export type { KumikoLinkProps } from "./app/nav";
export { KumikoLink, useBrowserNavApi } from "./app/nav";
export { useResolvers } from "./app/resolvers-context";
export type { AppLayoutProps } from "./layout/app-layout";
export { AppLayout } from "./layout/app-layout";
export type { AvatarProps, AvatarSize } from "./layout/avatar";
export { Avatar } from "./layout/avatar";
export type { DefaultAppShellProps } from "./layout/default-app-shell";
export { DefaultAppShell } from "./layout/default-app-shell";
export type { EditorPanelProps, ResolverComponent } from "./layout/editor-panel";
export { EditorPanel } from "./layout/editor-panel";
export type { LanguageSwitcherProps, LocaleOption } from "./layout/language-switcher";
export { LanguageSwitcher } from "./layout/language-switcher";
export type { NavTreeProps } from "./layout/nav-tree";
export { buildNavRegistrySlice, NavTree } from "./layout/nav-tree";
export type { ProfileMenuItem, ProfileMenuProps } from "./layout/profile-menu";
export { ProfileMenu } from "./layout/profile-menu";
export type { SidebarProps } from "./layout/sidebar";
export { Sidebar } from "./layout/sidebar";
export type { SidebarBrandProps } from "./layout/sidebar-brand";
export { SidebarBrand } from "./layout/sidebar-brand";
export type { SidebarUserProps } from "./layout/sidebar-user";
export { SidebarUser } from "./layout/sidebar-user";
export { parseTargetFromSearchParams } from "./layout/target-url";
export type { ThemeToggleProps } from "./layout/theme-toggle";
export { ThemeToggle } from "./layout/theme-toggle";
export type { TopbarProps } from "./layout/topbar";
export { Topbar } from "./layout/topbar";
export type { WorkspaceShellProps, WorkspaceShellUser } from "./layout/workspace-shell";
export { filterByAccess, resolveDefaultId, WorkspaceShell } from "./layout/workspace-shell";
export type { WorkspaceSwitcherProps } from "./layout/workspace-switcher";
export { WorkspaceSwitcher } from "./layout/workspace-switcher";
export { cn } from "./lib/cn";
export { postWithDownload } from "./lib/download";
export { BareFormProvider, defaultPrimitives } from "./primitives";
export type { ActionMenuProps, MenuItemDef } from "./primitives/action-menu";
export { ActionMenu } from "./primitives/action-menu";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu";
export type { ToastOptions, ToastProviderProps, ToastVariant } from "./primitives/toast";
export { ToastProvider, useToast } from "./primitives/toast";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events";
export { createEventSourceLiveEvents } from "./sse/live-events";
export {
  applyTokensToCssVars,
  defaultTokens,
  lightTokens,
  useBrowserTokensApi,
} from "./tokens";
export { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "./ui/sidebar";
