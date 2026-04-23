// Public entry für @kumiko/renderer-web. Re-exportiert die shared-
// API aus @kumiko/renderer damit Samples nur ein Paket importieren
// müssen, und fügt die Web-spezifischen Helpers dazu: createKumikoApp
// (react-dom-bootstrap), defaultPrimitives (HTML), useBrowserNavApi
// (window.history), createEventSourceLiveEvents, KumikoLink.

// --- Shared re-exports (Components, Hooks, Types, Contexts) ---
export type {
  AppPrimitives,
  BannerProps,
  ButtonProps,
  ColorTokens,
  CorePrimitives,
  DataTableProps,
  DispatcherProviderProps,
  FeatureSchema,
  FieldProps,
  FontSizeTokens,
  FormProps,
  GridCellProps,
  GridProps,
  InputProps,
  KumikoScreenProps,
  LiveEvent,
  LiveEventSubscriber,
  LiveEventsProviderProps,
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
  SpacingTokens,
  TextProps,
  Tokens,
  TokensOverride,
  TokensProviderProps,
  UseFormOptions,
  UseFormResult,
  UseQueryOptions,
  UseQueryResult,
} from "@kumiko/renderer";
export {
  DispatcherProvider,
  formatPath,
  KumikoScreen,
  LiveEventsProvider,
  mergeTokens,
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
  useNav,
  usePrimitives,
  useQuery,
  useTokenController,
  useTokens,
} from "@kumiko/renderer";

// --- Web-platform specifics ---
export type { CreateKumikoAppOptions } from "./app/create-app";
export { createKumikoApp } from "./app/create-app";
export type { KumikoLinkProps } from "./app/nav";
export { KumikoLink, useBrowserNavApi } from "./app/nav";
export { defaultPrimitives } from "./primitives";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events";
export { createEventSourceLiveEvents } from "./sse/live-events";
export { applyTokensToCssVars, defaultTokens, lightTokens } from "./tokens";
