// Platform-agnostic React renderer for Kumiko screens. Das ist der
// Shared-Layer: Components, Hooks, Contexts, Types. Plattform-Impls
// (Web-DOM, React-Native) leben in den jeweiligen Plattform-Packages
// und reichen ihre konkreten Primitives/Nav/SSE-Impls via Provider
// in diesen Baum.
//
// Wer diesen Layer direkt konsumiert: andere Renderer-Packages
// (@cosmicdrift/kumiko-renderer-web, später -native) oder eine App die ihren
// eigenen Bootstrap schreiben will. Normale Samples gehen über
// @cosmicdrift/kumiko-renderer-web/createKumikoApp, das alle Provider verdrahtet.

export { type Formality, formalLocaleTag } from "@cosmicdrift/kumiko-framework/ui-types";
export { synthesizeActionFormEntity, synthesizeActionFormScreen } from "./app/action-form-shim.js";
export type { AppFeaturesProviderProps } from "./app/app-features-context.js";
export { AppFeaturesProvider, useAppFeatures } from "./app/app-features-context.js";
export type {
  ColumnRendererComponent,
  ColumnRendererProps,
  ColumnRenderersMap,
  ColumnRenderersProviderProps,
} from "./app/column-renderers.js";
export { ColumnRenderersProvider, useColumnRenderer } from "./app/column-renderers.js";
export type {
  ContentEditorComponent,
  ContentEditorProps,
  ContentEditorsMap,
  ContentEditorsProviderProps,
} from "./app/content-editors.js";
export {
  CONTENT_EDITOR_ELEMENT_ID,
  ContentEditorsProvider,
  TextareaContentEditor,
  useContentEditor,
} from "./app/content-editors.js";
export type { ContentPreviewProps } from "./app/content-preview.js";
export { ContentPreview, substituteVariables } from "./app/content-preview.js";
export type { CustomScreensMap, CustomScreensProviderProps } from "./app/custom-screens.js";
export { CustomScreensProvider, useCustomScreenComponent } from "./app/custom-screens.js";
export type { DashboardBodyProps, DashboardBodyProviderProps } from "./app/dashboard-body.js";
export { DashboardBodyProvider, useDashboardBody } from "./app/dashboard-body.js";
export type {
  ExtensionFormRegistry,
  ExtensionFormSubmitHandler,
  ExtensionSubmitContext,
  ExtensionSubmitResult,
} from "./app/extension-form-submit.js";
export {
  ExtensionFormRegistryProvider,
  useExtensionFormSubmit,
} from "./app/extension-form-submit.js";
export type {
  ExtensionSectionComponent,
  ExtensionSectionProps,
  ExtensionSectionsMap,
  ExtensionSectionsProviderProps,
} from "./app/extension-sections.js";
export {
  ExtensionSectionsProvider,
  extensionSectionName,
  useExtensionSectionComponent,
} from "./app/extension-sections.js";
export type {
  AppSchema,
  FeatureSchema,
  QualifiedContentCollection,
  WorkspaceSchema,
} from "./app/feature-schema.js";
export { isAppSchema, toAppSchema } from "./app/feature-schema.js";
export type { KumikoScreenProps } from "./app/kumiko-screen.js";
export { KumikoScreen, qualifyNavId, qualifyScreenId } from "./app/kumiko-screen.js";
export type { DateRangeBound, DateRangeValue, ResolvedDateRangeFacet } from "./app/list-facets.js";
export {
  buildDateRangePayload,
  clampDateRange,
  readDateRange,
  resolveDateRangeFacets,
} from "./app/list-facets.js";
export type {
  NavApi,
  NavProviderProps,
  NavRoute,
  NavTarget,
  ObjectTarget,
  ScreenTarget,
} from "./app/nav.js";
export {
  formatPath,
  hasDetailScreen,
  NavProvider,
  parsePath,
  resolveTarget,
  useNav,
  useNavigateWithInitialValues,
} from "./app/nav.js";
export { lastSegment } from "./app/qn.js";
export type { ReturnHost, ReturnTo } from "./app/return-to.js";
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
} from "./app/return-to.js";
export type { EmbeddedScreenTarget } from "./app/use-embedded-screen.js";
export { useEmbeddedScreen } from "./app/use-embedded-screen.js";
export type { VariableChipsProps } from "./app/variable-chips.js";
export { VariableChips } from "./app/variable-chips.js";
export { dispatcherErrorText, WriteFailedError } from "./app/write-failed-error.js";
export { RelatedListSection } from "./components/related-list-section.js";
export type {
  RenderEditAction,
  RenderEditChangeState,
  RenderEditControls,
  RenderEditProps,
} from "./components/render-edit.js";
export { RenderEdit } from "./components/render-edit.js";
export { needsActionConfirm } from "./components/render-edit-action-button.js";
export type { RenderFieldProps } from "./components/render-field.js";
export { RenderField } from "./components/render-field.js";
export type { RenderListProps } from "./components/render-list.js";
export { RenderList } from "./components/render-list.js";
export type { DispatcherProviderProps } from "./context/dispatcher-context.js";
export {
  DispatcherProvider,
  useDispatcher,
  useDispatcherStatus,
  useOptionalDispatcher,
} from "./context/dispatcher-context.js";
export type { DraftStorage, DraftStorageProviderProps } from "./context/draft-storage-context.js";
export { DraftStorageProvider, useDraftStorage } from "./context/draft-storage-context.js";
export { EmbeddedScreenProvider, useIsEmbeddedScreen } from "./context/embedded-screen-context.js";
export type { UserRolesProviderProps } from "./context/user-roles-context.js";
export { UserRolesProvider, useUserRoles } from "./context/user-roles-context.js";
export { formatWhen } from "./format-when.js";
export {
  REFERENCE_COMBOBOX_LIMIT,
  REFERENCE_LIST_LOOKUP_LIMIT,
  REFERENCE_SEARCH_DEBOUNCE_MS,
} from "./hooks/reference-limits.js";
export type {
  AiTextActionState,
  AiTextMode,
  AiTextRewriteStyle,
  AiTextRunPayload,
  AiTextRunResult,
  AiTextUsage,
  UseAiTextActionResult,
  UseCompletionResult,
} from "./hooks/use-ai-text.js";
export { AI_TEXT_RUN_QN, useAiTextAction, useCompletion } from "./hooks/use-ai-text.js";
export type { UseDisclosureResult } from "./hooks/use-disclosure.js";
export { useDisclosure } from "./hooks/use-disclosure.js";
export type { UseFormOptions, UseFormResult } from "./hooks/use-form.js";
export { useForm } from "./hooks/use-form.js";
export type {
  ListSort,
  ListSortDir,
  ListUrlState,
  ListUrlStateApi,
} from "./hooks/use-list-url-state.js";
export { useListUrlState } from "./hooks/use-list-url-state.js";
export type { UseMutationResult } from "./hooks/use-mutation.js";
export { useMutation } from "./hooks/use-mutation.js";
export type { UseQueryOptions, UseQueryResult } from "./hooks/use-query.js";
export { entityFromQueryType, useQuery } from "./hooks/use-query.js";
export { useReportStepComplete } from "./hooks/use-report-step-complete.js";
export { useStore, useStoreSelector } from "./hooks/use-store.js";
export type {
  StreamStatus,
  UseStreamHandlerOptions,
  UseStreamHandlerResult,
} from "./hooks/use-stream-handler.js";
export { useStreamHandler } from "./hooks/use-stream-handler.js";
export type {
  LocaleProviderProps,
  TranslationBundle,
  TranslationsByKey,
  TranslationsByLocale,
} from "./i18n.js";
export {
  createStaticLocaleResolver,
  FormalityProvider,
  LocaleProvider,
  mergeTranslations,
  translationsByLocaleFromKeys,
  useFormality,
  useLocale,
  useOptionalLocale,
  useOptionalTranslation,
  useTranslation,
} from "./i18n.js";
export { kumikoDefaultTranslations } from "./i18n-defaults.js";
export { InsideDrawerProvider, useInsideDrawer } from "./inside-drawer.js";
export {
  PageHeaderCompactProvider,
  PageHeaderSlotAvailableProvider,
  usePageHeaderCompact,
  usePageHeaderSlotAvailable,
} from "./page-header-slot.js";
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
  FillContainerProps,
  FormProps,
  FormSectionNavItem,
  FormWidth,
  GridCellProps,
  GridProps,
  HeadingProps,
  InputProps,
  JsonViewProps,
  LightboxProps,
  LinkProps,
  MetricBandProps,
  MetricProps,
  ModalProps,
  PageHeaderProps,
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
} from "./primitives.js";
export {
  PrimitivesProvider,
  STICKY_PRIMARY_ACTION_PROP,
  shouldRenderActionsIconOnly,
  statusToneForOptionTone,
  statusToneForValue,
  usePrimitives,
} from "./primitives.js";
export type {
  SessionEndedSignal,
  SessionEndedSignalProviderProps,
} from "./session/session-ended.js";
export {
  createSessionEndedSignal,
  isSessionEndedError,
  SESSION_ENDED_ERROR_CODES,
  SessionEndedSignalProvider,
  useSessionEndedSignal,
  withSessionEndedDetection,
} from "./session/session-ended.js";
export { buildWhatsAppShareUrl } from "./share-links.js";
export { sortByAccessor } from "./sort-by-accessor.js";
export type { LiveEvent, LiveEventSubscriber, LiveEventsProviderProps } from "./sse/live-events.js";
export { LiveEventsProvider, useLiveEvents } from "./sse/live-events.js";
export type {
  AppTokens,
  ColorTokens,
  CoreTokens,
  FontTokens,
  RadiusTokens,
  ShadowTokens,
  SpacingTokens,
  ThemeMode,
  Tokens,
  TokensApi,
  TokensProviderProps,
} from "./tokens.js";
export { cssVarTokens, TokensProvider, useTokenController, useTokens } from "./tokens.js";
