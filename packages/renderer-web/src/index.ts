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
  UseFormOptions,
  UseFormResult,
  UseQueryOptions,
  UseQueryResult,
} from "@kumiko/renderer";
export {
  cssVarTokens,
  DispatcherProvider,
  formatPath,
  KumikoScreen,
  LiveEventsProvider,
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
export type { AppLayoutProps } from "./layout/app-layout";
export { AppLayout } from "./layout/app-layout";
export type { NavTreeProps } from "./layout/nav-tree";
export { buildNavRegistrySlice, NavTree } from "./layout/nav-tree";
export type { SidebarProps } from "./layout/sidebar";
export { Sidebar } from "./layout/sidebar";
export type { TopbarProps } from "./layout/topbar";
export { Topbar } from "./layout/topbar";
export { defaultPrimitives } from "./primitives";
export type { CreateEventSourceLiveEventsOptions } from "./sse/live-events";
export { createEventSourceLiveEvents } from "./sse/live-events";
export {
  applyTokensToCssVars,
  defaultTokens,
  lightTokens,
  useBrowserTokensApi,
} from "./tokens";
