// Platform-agnostic React renderer for Kumiko screens. Das ist der
// Shared-Layer: Components, Hooks, Contexts, Types. Plattform-Impls
// (Web-DOM, React-Native) leben in den jeweiligen Plattform-Packages
// und reichen ihre konkreten Primitives/Nav/SSE-Impls via Provider
// in diesen Baum.
//
// Direct consumers of this layer: platform bindings
// (@cosmicdrift/kumiko-renderer/web) or an app writing its own bootstrap.
// Normal samples go through createKumikoApp from
// @cosmicdrift/kumiko-renderer/web, which wires all providers.

export { type Formality, formalLocaleTag } from "@cosmicdrift/kumiko-framework/ui-types";
export { synthesizeActionFormEntity, synthesizeActionFormScreen } from "./app/action-form-shim.ts";
export type { AppFeaturesProviderProps } from "./app/app-features-context.tsx";
export { AppFeaturesProvider, useAppFeatures } from "./app/app-features-context.tsx";
export type {
  ActionNotice,
  ActionNotifier,
  ClientActionHandler,
  ClientActionOutcome,
  ClientActionRuntime,
  ClientActionsMap,
} from "./app/client-actions.tsx";
export {
  ActionNoticeProvider,
  ClientActionsProvider,
  runClientAction,
  useClientActionHandler,
  useClientActionRuntime,
} from "./app/client-actions.tsx";
export type {
  ColumnRendererComponent,
  ColumnRendererProps,
  ColumnRenderersMap,
  ColumnRenderersProviderProps,
} from "./app/column-renderers.tsx";
export { ColumnRenderersProvider, useColumnRenderer } from "./app/column-renderers.tsx";
export type {
  ContentEditorComponent,
  ContentEditorProps,
  ContentEditorsMap,
  ContentEditorsProviderProps,
} from "./app/content-editors.tsx";
export {
  CONTENT_EDITOR_ELEMENT_ID,
  ContentEditorsProvider,
  TextareaContentEditor,
  useContentEditor,
} from "./app/content-editors.tsx";
export type { ContentPreviewProps } from "./app/content-preview.tsx";
export { ContentPreview, substituteVariables } from "./app/content-preview.tsx";
export type { CustomScreensMap, CustomScreensProviderProps } from "./app/custom-screens.tsx";
export { CustomScreensProvider, useCustomScreenComponent } from "./app/custom-screens.tsx";
export type { DashboardBodyProps, DashboardBodyProviderProps } from "./app/dashboard-body.tsx";
export { DashboardBodyProvider, useDashboardBody } from "./app/dashboard-body.tsx";
export { type ErrorNotice, ErrorReference, errorNoticeOf } from "./app/error-reference.tsx";
export type {
  ExtensionFormRegistry,
  ExtensionFormSubmitHandler,
  ExtensionSubmitContext,
  ExtensionSubmitResult,
} from "./app/extension-form-submit.tsx";
export {
  ExtensionFormRegistryProvider,
  useExtensionFormSubmit,
} from "./app/extension-form-submit.tsx";
export type {
  ExtensionSectionComponent,
  ExtensionSectionProps,
  ExtensionSectionsMap,
  ExtensionSectionsProviderProps,
} from "./app/extension-sections.tsx";
export {
  ExtensionSectionsProvider,
  extensionSectionName,
  useExtensionSectionComponent,
} from "./app/extension-sections.tsx";
export type {
  AppSchema,
  FeatureSchema,
  QualifiedContentCollection,
  WorkspaceSchema,
} from "./app/feature-schema.ts";
export { isAppSchema, toAppSchema } from "./app/feature-schema.ts";
export { HeaderActionsBar } from "./app/header-actions-bar.tsx";
export type { KumikoScreenProps } from "./app/kumiko-screen.tsx";
export { KumikoScreen, qualifyNavId, qualifyScreenId } from "./app/kumiko-screen.tsx";
export type { DateRangeBound, DateRangeValue, ResolvedDateRangeFacet } from "./app/list-facets.ts";
export {
  buildDateRangePayload,
  clampDateRange,
  readDateRange,
  resolveDateRangeFacets,
} from "./app/list-facets.ts";
export type {
  NavApi,
  NavigateOptions,
  NavProviderProps,
  NavRoute,
  NavTarget,
  ObjectTarget,
  ScreenTarget,
} from "./app/nav.tsx";
export {
  formatPath,
  hasDetailScreen,
  NavProvider,
  parsePath,
  resolveTarget,
  useNav,
  useNavigateWithInitialValues,
  useOptionalNav,
} from "./app/nav.tsx";
export { lastSegment } from "./app/qn.ts";
export type { ReturnHost, ReturnTo } from "./app/return-to.tsx";
export {
  navigateToReturn,
  navigateToReturnOr,
  navigateWithReturnTo,
  RETURN_TO_PARAM,
  ReturnHostProvider,
  resolveReturnTarget,
  splitReturnTo,
  useReturnHost,
  useReturnTarget,
} from "./app/return-to.tsx";
export { ScreenMissingState } from "./app/screen-shared.tsx";
export type { EmbeddedScreenTarget } from "./app/use-embedded-screen.ts";
export { useEmbeddedScreen } from "./app/use-embedded-screen.ts";
export { useRecordActions } from "./app/use-record-actions.ts";
export type { VariableChipsProps } from "./app/variable-chips.tsx";
export { VariableChips } from "./app/variable-chips.tsx";
export { evalVisibleWhen, type VisibleWhenVerdict } from "./app/visible-when.ts";
export { dispatcherErrorText, WriteFailedError } from "./app/write-failed-error.ts";
export type {
  ErrorBoundaryFallbackProps,
  ErrorBoundaryProps,
} from "./components/error-boundary.tsx";
export { ErrorBoundary } from "./components/error-boundary.tsx";
export type { FormScreenLayoutProps } from "./components/form-screen-layout.tsx";
export { FormScreenLayout } from "./components/form-screen-layout.tsx";
export { RelatedListSection } from "./components/related-list-section.tsx";
export type {
  RenderEditAction,
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
} from "./components/render-edit.tsx";
export { RenderEdit } from "./components/render-edit.tsx";
export { needsActionConfirm } from "./components/render-edit-action-button.tsx";
export type { RenderFieldProps } from "./components/render-field.tsx";
export { RenderField } from "./components/render-field.tsx";
export type { RenderListProps } from "./components/render-list.tsx";
export { RenderList } from "./components/render-list.tsx";
export type { DispatcherProviderProps } from "./context/dispatcher-context.tsx";
export {
  DispatcherProvider,
  useDispatcher,
  useDispatcherStatus,
  useOptionalDispatcher,
} from "./context/dispatcher-context.tsx";
export type { DraftStorage, DraftStorageProviderProps } from "./context/draft-storage-context.tsx";
export { DraftStorageProvider, useDraftStorage } from "./context/draft-storage-context.tsx";
export { EmbeddedScreenProvider, useIsEmbeddedScreen } from "./context/embedded-screen-context.tsx";
export type { UserRolesProviderProps } from "./context/user-roles-context.tsx";
export { UserRolesProvider, useUserRoles } from "./context/user-roles-context.tsx";
export type { CurrentUser } from "./current-user.tsx";
export { CurrentUserProvider, useOptionalCurrentUser } from "./current-user.tsx";
export { formatWhen } from "./format-when.ts";
export {
  REFERENCE_COMBOBOX_LIMIT,
  REFERENCE_LIST_LOOKUP_LIMIT,
  REFERENCE_SEARCH_DEBOUNCE_MS,
} from "./hooks/reference-limits.ts";
export type {
  AiTextActionState,
  AiTextMode,
  AiTextRewriteStyle,
  AiTextRunPayload,
  AiTextRunResult,
  AiTextUsage,
  UseAiTextActionResult,
  UseCompletionResult,
} from "./hooks/use-ai-text.ts";
export { AI_TEXT_RUN_QN, useAiTextAction, useCompletion } from "./hooks/use-ai-text.ts";
export type { UseDisclosureResult } from "./hooks/use-disclosure.ts";
export { useDisclosure } from "./hooks/use-disclosure.ts";
export type { UseFormOptions, UseFormResult } from "./hooks/use-form.ts";
export { useForm } from "./hooks/use-form.ts";
export type {
  ListSort,
  ListSortDir,
  ListUrlState,
  ListUrlStateApi,
} from "./hooks/use-list-url-state.ts";
export { listFilterUrlKey, useListUrlState } from "./hooks/use-list-url-state.ts";
export type { UseMutationResult } from "./hooks/use-mutation.ts";
export { useMutation } from "./hooks/use-mutation.ts";
export type { UseQueryOptions, UseQueryResult } from "./hooks/use-query.ts";
export { entityFromQueryType, useQuery } from "./hooks/use-query.ts";
export { useReportStepComplete } from "./hooks/use-report-step-complete.ts";
export { useStore, useStoreSelector } from "./hooks/use-store.ts";
export type {
  StreamStatus,
  UseStreamHandlerOptions,
  UseStreamHandlerResult,
} from "./hooks/use-stream-handler.ts";
export { useStreamHandler } from "./hooks/use-stream-handler.ts";
export type {
  LocaleProviderProps,
  TranslationBundle,
  TranslationsByKey,
  TranslationsByLocale,
} from "./i18n.tsx";
export {
  createStaticLocaleResolver,
  FormalityProvider,
  LocaleProvider,
  mergeTranslations,
  translationsByKeyFromLocales,
  translationsByLocaleFromKeys,
  useFormality,
  useLocale,
  useOptionalLocale,
  useOptionalTranslation,
  useTranslation,
} from "./i18n.tsx";
export { kumikoDefaultTranslations } from "./i18n-defaults.ts";
export { InsideDrawerProvider, useInsideDrawer } from "./inside-drawer.ts";
export {
  hasUnsavedInput,
  registerUnsavedInputSource,
  requestLeave,
  setLeaveConfirmer,
  useUnsavedInputSource,
} from "./leave-guard.ts";
export { LeaveGuardDialog } from "./leave-guard-dialog.tsx";
export {
  PageHeaderCompactProvider,
  PageHeaderSlotAvailableProvider,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
} from "./page-header-slot.ts";
export type {
  ActionMenuItemSpec,
  ActionOverflowMenuProps,
  AppPrimitives,
  BannerProps,
  ButtonProps,
  CardOptions,
  CardProps,
  CardSlots,
  CopyButtonProps,
  CorePrimitives,
  DataTableDateRangeFacet,
  DataTableFacet,
  DataTableFacetChip,
  DataTableProps,
  DataTableRowAction,
  DataTableRowActionMode,
  DataTableRowGrouping,
  DataTableSort,
  DataTableSortDir,
  DialogProps,
  DrawerProps,
  EmbeddedListCellType,
  EmbeddedListColumn,
  EmbeddedListInputProps,
  EmbeddedListTotal,
  FieldCellWidth,
  FieldProps,
  FileValueListProps,
  FillContainerProps,
  FooterActionMarker,
  FooterActionRole,
  FormProps,
  FormSectionNavItem,
  FormWidth,
  GridCellProps,
  GridProps,
  HeadingProps,
  InputFillAction,
  InputProps,
  JsonViewProps,
  LightboxImage,
  LightboxProps,
  LinkProps,
  MetricBandProps,
  MetricProps,
  ModalProps,
  PageHeaderProps,
  PickedFile,
  PrimitivesProviderProps,
  PrimitivesRegistry,
  ProgressProps,
  ProgressTone,
  PromoPanelAction,
  PromoPanelProps,
  RuntimeRenderer,
  SecretRevealProps,
  SecretRevealValue,
  SectionProps,
  ShareButtonProps,
  StatusBadgeProps,
  StatusTone,
  StepBarProps,
  StickyActionBarProps,
  StickyPrimaryActionMarker,
  TabsProps,
  TextProps,
  TrailingInputAction,
  WizardStepGroupProps,
} from "./primitives.tsx";
export {
  FOOTER_ACTION_ROLE_PROP,
  NARROW_LABEL_PROP,
  PrimitivesProvider,
  STICKY_PRIMARY_ACTION_PROP,
  shouldRenderActionsIconOnly,
  statusToneForOptionTone,
  statusToneForValue,
  useOptionalPrimitives,
  usePrimitives,
} from "./primitives.tsx";
export type {
  SessionEndedSignal,
  SessionEndedSignalProviderProps,
} from "./session/session-ended.tsx";
export {
  createSessionEndedSignal,
  isSessionEndedError,
  SESSION_ENDED_ERROR_CODES,
  SessionEndedSignalProvider,
  useSessionEndedSignal,
  withSessionEndedDetection,
} from "./session/session-ended.tsx";
export { buildWhatsAppShareUrl } from "./share-links.ts";
export { sortByAccessor } from "./sort-by-accessor.ts";
export type {
  LiveEvent,
  LiveEventSubscriber,
  LiveEventsProviderProps,
} from "./sse/live-events.tsx";
export { LIVE_RESYNC_EVENT_TYPE, LiveEventsProvider, useLiveEvents } from "./sse/live-events.tsx";
export type {
  AppTokens,
  ColorTokens,
  CoreTokens,
  FontTokens,
  RadiusTokens,
  ShadowTokens,
  SpacingTokens,
  ThemeMode,
  ThemePreference,
  Tokens,
  TokensApi,
  TokensProviderProps,
} from "./tokens.tsx";
export { cssVarTokens, TokensProvider, useTokenController, useTokens } from "./tokens.tsx";
