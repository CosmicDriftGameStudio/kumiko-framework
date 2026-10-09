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
  CardProps,
  ColorTokens,
  CorePrimitives,
  CoreTokens,
  DataTableProps,
  DispatcherProviderProps,
  FeatureSchema,
  FieldProps,
  FontTokens,
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
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
  RenderFieldProps,
  RenderListProps,
  SectionProps,
  ShadowTokens,
  SpacingTokens,
  TextProps,
  ThemeMode,
  ThemePreference,
  Tokens,
  TokensApi,
  TokensProviderProps,
  TranslationBundle,
  TranslationsByLocale,
  UseFormOptions,
  UseFormResult,
  UseQueryOptions,
  UseQueryResult,
  UserRolesProviderProps,
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
  synthesizeActionFormEntity,
  synthesizeActionFormScreen,
  TokensProvider,
  UserRolesProvider,
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
  useUserRoles,
} from "@cosmicdrift/kumiko-renderer";
// --- Web-platform specifics ---
export {
  BROWSER_LOCALE_STORAGE_KEY,
  type CreateBrowserLocaleResolverOptions,
  createBrowserLocaleResolver,
} from "./app/browser-locale.js";
export type { ClientFeatureDefinition } from "./app/client-plugin.js";
export type { CreateKumikoAppOptions } from "./app/create-app.js";
export { createKumikoApp } from "./app/create-app.js";
export type { CreatePublicSurfaceOptions, PublicRoute } from "./app/create-public-surface.js";
export { createPublicSurface } from "./app/create-public-surface.js";
export type { CreateBrowserDraftStorageOptions } from "./app/draft-storage.js";
export { createBrowserDraftStorage } from "./app/draft-storage.js";
export type { KumikoLinkProps } from "./app/nav.js";
export { KumikoLink, useBrowserNavApi } from "./app/nav.js";
export { PlainContentEditor } from "./app/plain-content-editor.js";
export { useResolvers } from "./app/resolvers-context.js";
export { RichContentEditor } from "./app/rich-content-editor.js";
export type { NavIconKey } from "./icons.js";
export { Icon } from "./icons.js";
export type { AppLayoutProps } from "./layout/app-layout.js";
export { AppLayout } from "./layout/app-layout.js";
export type { AvatarProps, AvatarSize } from "./layout/avatar.js";
export { Avatar } from "./layout/avatar.js";
export type { DefaultAppShellProps } from "./layout/default-app-shell.js";
export { DefaultAppShell } from "./layout/default-app-shell.js";
export type { EditorPanelProps, ResolverComponent } from "./layout/editor-panel.js";
export { EditorPanel } from "./layout/editor-panel.js";
export type { NavReparentOverride } from "./layout/filter-app-schema-navs.js";
export { filterAppSchemaNavsByAllowlist } from "./layout/filter-app-schema-navs.js";
export type { HeaderActionGroupProps } from "./layout/header-action-group.js";
export { HeaderActionGroup } from "./layout/header-action-group.js";
export type { LanguageMenuItemsProps } from "./layout/language-menu-items.js";
export { LanguageMenuItems } from "./layout/language-menu-items.js";
export type { LanguageSwitcherProps, LocaleOption } from "./layout/language-switcher.js";
export { LanguageSwitcher } from "./layout/language-switcher.js";
export type { NavTreeProps } from "./layout/nav-tree.js";
export { buildNavRegistrySlice, buildNavRegistrySliceForApp, NavTree } from "./layout/nav-tree.js";
export type { ProfileMenuItem, ProfileMenuProps } from "./layout/profile-menu.js";
export { ProfileMenu } from "./layout/profile-menu.js";
export type { SidebarProps } from "./layout/sidebar.js";
export { Sidebar } from "./layout/sidebar.js";
export type { SidebarBrandProps } from "./layout/sidebar-brand.js";
export { SidebarBrand } from "./layout/sidebar-brand.js";
export { SidebarPanel } from "./layout/sidebar-panel.js";
export type { SidebarUserProps } from "./layout/sidebar-user.js";
export { SidebarUser } from "./layout/sidebar-user.js";
export { parseTargetFromSearchParams } from "./layout/target-url.js";
export type { ThemeMenuItemProps } from "./layout/theme-menu-item.js";
export { ThemeMenuItem } from "./layout/theme-menu-item.js";
export type { ThemeToggleProps } from "./layout/theme-toggle.js";
export { ThemeToggle } from "./layout/theme-toggle.js";
export type { TopbarProps } from "./layout/topbar.js";
export { Topbar } from "./layout/topbar.js";
export type { WorkspaceShellProps, WorkspaceShellUser } from "./layout/workspace-shell.js";
export { filterByAccess, resolveDefaultId, WorkspaceShell } from "./layout/workspace-shell.js";
export type { WorkspaceSwitcherProps } from "./layout/workspace-switcher.js";
export { WorkspaceSwitcher } from "./layout/workspace-switcher.js";
export { cn } from "./lib/cn.js";
export { postWithDownload } from "./lib/download.js";
export type { ActionMenuProps, MenuItemDef } from "./primitives/action-menu.js";
export { ActionMenu } from "./primitives/action-menu.js";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu.js";
export {
  BareFormProvider,
  DefaultCard as Card,
  defaultPrimitives,
  FormScreenShell,
  ScreenWidthProvider,
} from "./primitives/index.js";
export { PageSection, Stack } from "./primitives/layout.js";
export { formatMoney } from "./primitives/money-input.js";
export type { ToastOptions, ToastProviderProps, ToastVariant } from "./primitives/toast.js";
export { ToastProvider, useToast } from "./primitives/toast.js";
export { useIsNarrowViewport } from "./primitives/use-narrow-viewport.js";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events.js";
export { createEventSourceLiveEvents } from "./sse/live-events.js";
export {
  applyTokensToCssVars,
  defaultTokens,
  lightTokens,
  useBrowserTokensApi,
} from "./tokens.js";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable.js";
export { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "./ui/sidebar.js";
export type { KumikoBuild } from "./version/update-checker.js";
export { readLoadedBuild } from "./version/update-checker.js";
export type {
  AiTextAreaProps,
  AiTextFieldProps,
  BooleanFieldProps,
  ComparisonMetric,
  DateFieldProps,
  DrawerProps,
  FeedRow,
  FileFieldProps,
  FloatingPanelGeometry,
  FloatingPanelProps,
  InfinityListProps,
  InfinityListSelection,
  ModeSwitchVariant,
  NumberFieldProps,
  PhotoSlotSpec,
  PhotoSlotsProps,
  PlanCardActionSlot,
  PlanCardPrice,
  PlanCardProps,
  PlanGridProps,
  ProgressListRow,
  PublicShellProps,
  PublicShellVariant,
  QueryTableColumn,
  QueryTableProps,
  RangeFieldProps,
  ResultColumn,
  SelectFieldProps,
  SideBySideTableCell,
  SideBySideTableColumn,
  SideBySideTableRow,
  StatDelta,
  StatTone,
  StatusBadgeTone,
  StatusBarEntry,
  StatusTone,
  TextareaFieldProps,
  TextFieldProps,
  TimeseriesPoint,
  TimeseriesReferenceLine,
  TimeseriesXAxis,
  TimeseriesYAxis,
  UploadZoneProps,
} from "./widgets/index.js";
export {
  AiTextArea,
  AiTextField,
  BooleanField,
  CollapsibleSection,
  ComparisonTable,
  DateField,
  DetailList,
  Drawer,
  EmptyState,
  ErrorState,
  FeedList,
  FileField,
  FloatingPanel,
  InfinityList,
  LoadingState,
  MiniStat,
  ModeSwitch,
  MoneyField,
  NumberField,
  PercentField,
  PhotoSlots,
  PlanCard,
  PlanGrid,
  ProgressBar,
  ProgressList,
  PublicShell,
  QueryTable,
  RangeField,
  ResultPanel,
  ResultTable,
  SectionCard,
  SelectField,
  SideBySideTable,
  Sparkline,
  STATUS_TONE_TEXT,
  StatCard,
  StatusBadge,
  StatusBarChart,
  StepBar,
  smoothPath,
  TextareaField,
  TextField,
  TimeseriesChart,
  UploadZone,
  useDraft,
} from "./widgets/index.js";
