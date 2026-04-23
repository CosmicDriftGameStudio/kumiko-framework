// Platform-agnostic React renderer for Kumiko screens. Das ist der
// Shared-Layer: Components, Hooks, Contexts, Types. Plattform-Impls
// (Web-DOM, React-Native) leben in den jeweiligen Plattform-Packages
// und reichen ihre konkreten Primitives/Nav/SSE-Impls via Provider
// in diesen Baum.
//
// Wer diesen Layer direkt konsumiert: andere Renderer-Packages
// (@kumiko/renderer-web, später -native) oder eine App die ihren
// eigenen Bootstrap schreiben will. Normale Samples gehen über
// @kumiko/renderer-web/createKumikoApp, das alle Provider verdrahtet.

export type { FeatureSchema } from "./app/feature-schema";
export type { KumikoScreenProps } from "./app/kumiko-screen";
export { KumikoScreen, qualifyScreenId } from "./app/kumiko-screen";
export type { NavApi, NavProviderProps, NavRoute, NavTarget } from "./app/nav";
export { formatPath, NavProvider, parsePath, useNav } from "./app/nav";
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
} from "./context/dispatcher-context";
export type { UseFormOptions, UseFormResult } from "./hooks/use-form";
export { useForm } from "./hooks/use-form";
export type { UseQueryOptions, UseQueryResult } from "./hooks/use-query";
export { useQuery } from "./hooks/use-query";
export type {
  AppPrimitives,
  BannerProps,
  ButtonProps,
  CorePrimitives,
  DataTableProps,
  FieldProps,
  FormProps,
  GridCellProps,
  GridProps,
  InputProps,
  PrimitivesProviderProps,
  PrimitivesRegistry,
  SectionProps,
  TextProps,
} from "./primitives";
export { PrimitivesProvider, usePrimitives } from "./primitives";
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
