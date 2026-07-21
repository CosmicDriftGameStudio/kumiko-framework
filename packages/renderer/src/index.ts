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

export type {
  ColumnRendererComponent,
  ColumnRendererProps,
  ColumnRenderersMap,
  ColumnRenderersProviderProps,
} from "./app/column-renderers";
export { ColumnRenderersProvider, useColumnRenderer } from "./app/column-renderers";
export type { CustomScreensMap, CustomScreensProviderProps } from "./app/custom-screens";
export { CustomScreensProvider, useCustomScreenComponent } from "./app/custom-screens";
export type { DashboardBodyProps, DashboardBodyProviderProps } from "./app/dashboard-body";
export { DashboardBodyProvider, useDashboardBody } from "./app/dashboard-body";
export type {
  ExtensionFormRegistry,
  ExtensionFormSubmitHandler,
  ExtensionSubmitContext,
  ExtensionSubmitResult,
} from "./app/extension-form-submit";
export { ExtensionFormRegistryProvider, useExtensionFormSubmit } from "./app/extension-form-submit";
export type {
  ExtensionSectionComponent,
  ExtensionSectionProps,
  ExtensionSectionsMap,
  ExtensionSectionsProviderProps,
} from "./app/extension-sections";
export {
  ExtensionSectionsProvider,
  extensionSectionName,
  useExtensionSectionComponent,
} from "./app/extension-sections";
export type { AppSchema, FeatureSchema, WorkspaceSchema } from "./app/feature-schema";
export { isAppSchema, toAppSchema } from "./app/feature-schema";
export type { KumikoScreenProps } from "./app/kumiko-screen";
export { KumikoScreen, qualifyNavId, qualifyScreenId } from "./app/kumiko-screen";
export type { NavApi, NavProviderProps, NavRoute, NavTarget } from "./app/nav";
export { formatPath, NavProvider, parsePath, useNav } from "./app/nav";
export { lastSegment } from "./app/qn";
export { dispatcherErrorText, WriteFailedError } from "./app/write-failed-error";
export type { RenderEditProps } from "./components/render-edit";
export { RenderEdit } from "./components/render-edit";
export type { RenderFieldProps } from "./components/render-field";
export { RenderField } from "./components/render-field";
export type { RenderListProps } from "./components/render-list";
export { RenderList } from "./components/render-list";
export type { DispatcherProviderProps } from "./context/dispatcher-context";
export {
  DispatcherProvider,
  useDispatcher,
  useDispatcherStatus,
  useOptionalDispatcher,
} from "./context/dispatcher-context";
export type { UserRolesProviderProps } from "./context/user-roles-context";
export { UserRolesProvider, useUserRoles } from "./context/user-roles-context";
export { formatWhen } from "./format-when";
export {
  REFERENCE_COMBOBOX_LIMIT,
  REFERENCE_LIST_LOOKUP_LIMIT,
  REFERENCE_SEARCH_DEBOUNCE_MS,
} from "./hooks/reference-limits";
export type {
  AiTextActionState,
  AiTextMode,
  AiTextRewriteStyle,
  AiTextRunPayload,
  AiTextRunResult,
  AiTextUsage,
  UseAiTextActionResult,
  UseCompletionResult,
} from "./hooks/use-ai-text";
export { AI_TEXT_RUN_QN, useAiTextAction, useCompletion } from "./hooks/use-ai-text";
export type { UseDisclosureResult } from "./hooks/use-disclosure";
export { useDisclosure } from "./hooks/use-disclosure";
export type { UseFormOptions, UseFormResult } from "./hooks/use-form";
export { useForm } from "./hooks/use-form";
export type {
  ListSort,
  ListSortDir,
  ListUrlState,
  ListUrlStateApi,
} from "./hooks/use-list-url-state";
export { useListUrlState } from "./hooks/use-list-url-state";
export type { UseMutationResult } from "./hooks/use-mutation";
export { useMutation } from "./hooks/use-mutation";
export type { UseQueryOptions, UseQueryResult } from "./hooks/use-query";
export { useQuery } from "./hooks/use-query";
export { useStore, useStoreSelector } from "./hooks/use-store";
export type {
  StreamStatus,
  UseStreamHandlerOptions,
  UseStreamHandlerResult,
} from "./hooks/use-stream-handler";
export { useStreamHandler } from "./hooks/use-stream-handler";
export type {
  LocaleProviderProps,
  TranslationBundle,
  TranslationsByKey,
  TranslationsByLocale,
} from "./i18n";
export {
  createStaticLocaleResolver,
  LocaleProvider,
  mergeTranslations,
  translationsByLocaleFromKeys,
  useLocale,
  useTranslation,
} from "./i18n";
export { kumikoDefaultTranslations } from "./i18n-defaults";
export type {
  AppPrimitives,
  BannerProps,
  ButtonProps,
  CardOptions,
  CardProps,
  CardSlots,
  CorePrimitives,
  DataTableFacet,
  DataTableProps,
  DataTableRowAction,
  DataTableRowActionMode,
  DataTableSort,
  DataTableSortDir,
  DialogProps,
  FieldProps,
  FormProps,
  GridCellProps,
  GridProps,
  HeadingProps,
  InputProps,
  LightboxProps,
  LinkProps,
  PrimitivesProviderProps,
  PrimitivesRegistry,
  RuntimeRenderer,
  SectionProps,
  TextProps,
} from "./primitives";
export { PrimitivesProvider, usePrimitives } from "./primitives";
export { sortByAccessor } from "./sort-by-accessor";
export type { LiveEvent, LiveEventSubscriber, LiveEventsProviderProps } from "./sse/live-events";
export { LiveEventsProvider, useLiveEvents } from "./sse/live-events";
export type {
  AppTokens,
  ColorTokens,
  CoreTokens,
  RadiusTokens,
  ThemeMode,
  Tokens,
  TokensApi,
  TokensProviderProps,
} from "./tokens";
export { cssVarTokens, TokensProvider, useTokenController, useTokens } from "./tokens";
