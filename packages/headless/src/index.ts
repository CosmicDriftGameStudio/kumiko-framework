export type { ParsedRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
// Re-Export aus framework/ui-types damit Renderer-Code denselben
// Parser nutzt wie der Server-Boot-Validator (Cross-Feature-Refs).
export { parseRefTarget } from "@cosmicdrift/kumiko-framework/ui-types";
export type {
  AssetResolution,
  AssetResolveContext,
  AssetResolver,
  BadgeProps,
  ButtonProps,
  CardProps,
  DatePickerProps,
  IconProps,
  LocaleResolver,
  ModalProps,
  NumberInputProps,
  PrimitiveCommonProps,
  PrimitivesContract,
  SelectOption,
  SelectProps,
  TextInputProps,
  ToastIntent,
  ToastProps,
  ToggleProps,
} from "./contracts";
export type {
  BatchResult,
  Command,
  Dispatcher,
  DispatcherError,
  DispatcherStatus,
  FieldIssue,
  PendingFile,
  PendingWrite,
  QueryOpts,
  QueryResult,
  WriteOpts,
  WriteResult,
} from "./dispatcher";
export type {
  FieldConditionPredicate,
  FieldConditions,
  FieldConditionValue,
  FieldState,
  FormController,
  FormControllerOptions,
  FormSnapshot,
  FormValues,
  SubmitConfig,
  SubmitPayloadMode,
  SubmitResult,
} from "./form";
export { createFormController } from "./form";
export type {
  NavDefinition,
  NavNode,
  NavRegistrySlice,
  NavTree,
  ResolveNavigationOptions,
} from "./nav";
export { resolveNavigation } from "./nav";
export type { Store, WritableStore } from "./store";
export { createStore, shallowEqual } from "./store";
export type {
  ComputeEditViewModelInput,
  ComputeListViewModelInput,
  EditExtensionSectionViewModel,
  EditFieldSpec,
  EditFieldsSectionViewModel,
  EditFieldViewModel,
  EditSectionSpec,
  EditSectionViewModel,
  EditViewModel,
  FieldConditionCtx,
  FieldRenderer,
  ListColumnSpec,
  ListColumnViewModel,
  ListRowViewModel,
  ListViewModel,
  RuntimeRenderer,
  ScreenSlots,
  Translate,
} from "./view-model";
export { computeEditViewModel, computeListViewModel, fieldLabelKey } from "./view-model";
