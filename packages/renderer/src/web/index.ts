// Public entry of @cosmicdrift/kumiko-renderer/web. Re-exports the shared API
// of the renderer root so samples import one entry, and adds the web-specific
// helpers: createKumikoApp (react-dom bootstrap), defaultPrimitives (HTML),
// useBrowserNavApi (window.history), createEventSourceLiveEvents, KumikoLink.

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
} from "../index.ts";
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
} from "../index.ts";
// --- Web-platform specifics ---
export {
  BROWSER_LOCALE_STORAGE_KEY,
  type CreateBrowserLocaleResolverOptions,
  createBrowserLocaleResolver,
} from "./app/browser-locale.ts";
export type { ClientFeatureDefinition } from "./app/client-plugin.tsx";
export type { CreateKumikoAppOptions } from "./app/create-app.tsx";
export { createKumikoApp } from "./app/create-app.tsx";
export type { CreatePublicSurfaceOptions, PublicRoute } from "./app/create-public-surface.tsx";
export { createPublicSurface } from "./app/create-public-surface.tsx";
export type { CreateBrowserDraftStorageOptions } from "./app/draft-storage.ts";
export { createBrowserDraftStorage } from "./app/draft-storage.ts";
export type { KumikoLinkProps } from "./app/nav.tsx";
export { KumikoLink, useBrowserNavApi } from "./app/nav.tsx";
export { PlainContentEditor } from "./app/plain-content-editor.tsx";
export { useResolvers } from "./app/resolvers-context.tsx";
export { clearRememberedListState } from "./app/session-list-state-store.ts";
export type { NavIconKey } from "./icons.tsx";
export { Icon } from "./icons.tsx";
export type { AppLayoutProps } from "./layout/app-layout.tsx";
export { AppLayout } from "./layout/app-layout.tsx";
export type { AvatarProps, AvatarSize } from "./layout/avatar.tsx";
export { Avatar } from "./layout/avatar.tsx";
export type { DefaultAppShellProps } from "./layout/default-app-shell.tsx";
export { DefaultAppShell } from "./layout/default-app-shell.tsx";
export type { EditorPanelProps, ResolverComponent } from "./layout/editor-panel.tsx";
export { EditorPanel } from "./layout/editor-panel.tsx";
export type { NavReparentOverride } from "./layout/filter-app-schema-navs.ts";
export {
  filterAppSchemaNavsByAllowlist,
  reparentAppSchemaNavs,
} from "./layout/filter-app-schema-navs.ts";
export type { HeaderActionGroupProps } from "./layout/header-action-group.tsx";
export { HeaderActionGroup } from "./layout/header-action-group.tsx";
export type { LanguageMenuItemsProps } from "./layout/language-menu-items.tsx";
export { LanguageMenuItems } from "./layout/language-menu-items.tsx";
export type { LanguageSwitcherProps, LocaleOption } from "./layout/language-switcher.tsx";
export { LanguageSwitcher } from "./layout/language-switcher.tsx";
export type { NavTreeProps } from "./layout/nav-tree.tsx";
export { buildNavRegistrySlice, buildNavRegistrySliceForApp, NavTree } from "./layout/nav-tree.tsx";
export type { ProfileMenuItem, ProfileMenuProps } from "./layout/profile-menu.tsx";
export { ProfileMenu } from "./layout/profile-menu.tsx";
export type { SidebarProps } from "./layout/sidebar.tsx";
export { Sidebar } from "./layout/sidebar.tsx";
export type { SidebarBrandProps } from "./layout/sidebar-brand.tsx";
export { SidebarBrand } from "./layout/sidebar-brand.tsx";
export { SidebarPanel } from "./layout/sidebar-panel.tsx";
export type { SidebarUserProps } from "./layout/sidebar-user.tsx";
export { SidebarUser } from "./layout/sidebar-user.tsx";
export { useDispatchTarget } from "./layout/target-resolver-stub.tsx";
export { parseTargetFromSearchParams } from "./layout/target-url.ts";
export type { ThemeMenuItemProps } from "./layout/theme-menu-item.tsx";
export { ThemeMenuItem } from "./layout/theme-menu-item.tsx";
export type { ThemeToggleProps } from "./layout/theme-toggle.tsx";
export { ThemeToggle } from "./layout/theme-toggle.tsx";
export type { TopbarProps } from "./layout/topbar.tsx";
export { Topbar } from "./layout/topbar.tsx";
export type { WorkspaceShellProps, WorkspaceShellUser } from "./layout/workspace-shell.tsx";
export { filterByAccess, resolveDefaultId, WorkspaceShell } from "./layout/workspace-shell.tsx";
export type { WorkspaceSwitcherProps } from "./layout/workspace-switcher.tsx";
export { WorkspaceSwitcher } from "./layout/workspace-switcher.tsx";
export { cn } from "./lib/cn.ts";
export { postWithDownload } from "./lib/download.ts";
export {
  downloadFileRef,
  FileDownloadFailedError,
  fetchFileRefBlob,
  fileNameFromContentDisposition,
  saveBlobAsFile,
} from "./lib/file-ref-download.ts";
export { buildFileUploadFormData } from "./lib/file-upload-form-data.ts";
export { type FileRefTarget, FileUploadFailedError, uploadFileRef } from "./lib/upload-file-ref.ts";
export type { ActionMenuProps, MenuItemDef } from "./primitives/action-menu.tsx";
export { ActionMenu } from "./primitives/action-menu.tsx";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./primitives/dropdown-menu.tsx";
export {
  BareFormProvider,
  DefaultCard as Card,
  defaultPrimitives,
  FormScreenShell,
  ScreenWidthProvider,
} from "./primitives/index.tsx";
export { PageSection, Stack } from "./primitives/layout.tsx";
export { formatMoney } from "./primitives/money-input.tsx";
export type { ToastOptions, ToastProviderProps, ToastVariant } from "./primitives/toast.tsx";
export { ToastProvider, useToast } from "./primitives/toast.tsx";
export { useIsNarrowViewport, useIsViewportBelow } from "./primitives/use-narrow-viewport.ts";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events.ts";
export { createEventSourceLiveEvents } from "./sse/live-events.ts";
export {
  applyTokensToCssVars,
  defaultTokens,
  lightTokens,
  useBrowserTokensApi,
} from "./tokens.ts";
export { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable.tsx";
export { SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from "./ui/sidebar.tsx";
export type { KumikoBuild } from "./version/update-checker.tsx";
export { readLoadedBuild } from "./version/update-checker.tsx";
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
  MessageAttachment,
  MessageBody,
  MessageReaderProps,
  MessageReaderTab,
  MessageThreadProps,
  ModeSwitchVariant,
  NumberFieldProps,
  PdfPreviewProps,
  PdfPreviewSource,
  PhotoSlotSpec,
  PhotoSlotsProps,
  PlanCardActionSlot,
  PlanCardLinkSlot,
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
  StepAction,
  StepListItem,
  StepListProps,
  StepStatus,
  StepTag,
  TextareaFieldProps,
  TextFieldProps,
  ThreadMessage,
  TimeseriesHeight,
  TimeseriesPoint,
  TimeseriesReferenceLine,
  TimeseriesXAxis,
  TimeseriesYAxis,
  UploadZoneProps,
} from "./widgets/index.ts";
export {
  AiSurface,
  AiTextArea,
  AiTextField,
  AttachmentChip,
  BooleanField,
  ChoiceCards,
  ClampedText,
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
  MessageReader,
  MessageThread,
  MiniStat,
  ModeSwitch,
  MoneyField,
  NumberField,
  PdfPreview,
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
  SenderFrame,
  SenderSheet,
  SideBySideTable,
  Sparkline,
  STATUS_TONE_TEXT,
  StatCard,
  StatusBadge,
  StatusBarChart,
  StepBar,
  StepList,
  smoothPath,
  TextareaField,
  TextField,
  TimeseriesChart,
  UploadZone,
  useDraft,
} from "./widgets/index.ts";
