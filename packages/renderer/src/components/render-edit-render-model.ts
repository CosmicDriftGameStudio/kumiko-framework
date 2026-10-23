import type { ReactNode } from "react";
import type { EditSectionViewModel, EditViewModel, FormValues } from "../headless/index.ts";
import type { FooterFlags, LayoutFlags } from "./render-edit-layout-flags.ts";
import type { TitleModel } from "./render-edit-titles.ts";
import type { RenderEditProps } from "./render-edit-types.ts";
import type { WizardNavigation } from "./render-edit-wizard-navigation.ts";
import type { RenderEditDraft } from "./use-render-edit-draft-save.ts";
import type { RenderEditForm } from "./use-render-edit-form.ts";
import type { RenderEditSections } from "./use-render-edit-sections.ts";
import type { RenderEditState } from "./use-render-edit-state.ts";
import type { RenderEditSteps } from "./use-render-edit-steps.ts";
import type { buildWizardDraftActions } from "./use-wizard-form-draft.ts";

type ResolvedKeys =
  | "payloadMode"
  | "markChangedFields"
  | "disabled"
  | "viewMode"
  | "valueDisplay"
  | "submitBlocked"
  | "i18nScreenId";

export type ResolvedRenderEditProps<TValues extends FormValues, TCtx = unknown> = Omit<
  RenderEditProps<TValues, TCtx>,
  ResolvedKeys
> & {
  readonly payloadMode: "values" | "changes";
  readonly markChangedFields: boolean;
  readonly disabled: boolean;
  readonly viewMode: boolean;
  readonly valueDisplay: "form" | "text";
  readonly submitBlocked: boolean;
  readonly i18nScreenId: string;
};

// View mode is a locked form, so everything keyed on `disabled` follows.
export function resolveRenderEditProps<TValues extends FormValues, TCtx>(
  props: RenderEditProps<TValues, TCtx>,
): ResolvedRenderEditProps<TValues, TCtx> {
  const viewMode = props.viewMode ?? false;
  return {
    ...props,
    payloadMode: props.payloadMode ?? "values",
    markChangedFields: props.markChangedFields ?? false,
    viewMode,
    disabled: (props.disabled ?? false) || viewMode,
    valueDisplay: props.valueDisplay ?? "form",
    submitBlocked: props.submitBlocked ?? false,
    i18nScreenId: props.i18nScreenId ?? props.screen.id,
  };
}

export type RenderEditCore<TValues extends FormValues, TCtx = unknown> = {
  readonly props: ResolvedRenderEditProps<TValues, TCtx>;
  readonly state: RenderEditState;
  readonly form: RenderEditForm<TValues>;
  readonly draft: RenderEditDraft<TValues>;
};

export type RenderEditSectioned<TValues extends FormValues, TCtx = unknown> = RenderEditCore<
  TValues,
  TCtx
> & {
  readonly sections: RenderEditSections;
};

export type RenderEditSteppedCore<TValues extends FormValues, TCtx = unknown> = RenderEditSectioned<
  TValues,
  TCtx
> & {
  readonly steps: RenderEditSteps;
};

export type WizardDraftActions<TValues extends FormValues> = ReturnType<
  typeof buildWizardDraftActions<TValues>
>;

export type RenderEditEngineBase<
  TValues extends FormValues,
  TCtx = unknown,
> = RenderEditSteppedCore<TValues, TCtx> & {
  readonly draftActions: WizardDraftActions<TValues>;
  readonly nav: WizardNavigation;
};

export type RenderEditEngine<TValues extends FormValues, TCtx = unknown> = RenderEditEngineBase<
  TValues,
  TCtx
> & {
  readonly handleSubmit: (options?: { readonly saveNow?: boolean }) => Promise<void>;
};

export type { EditSectionViewModel, EditViewModel };

export type RenderEditModel<TValues extends FormValues, TCtx = unknown> = {
  readonly engine: RenderEditEngine<TValues, TCtx>;
  readonly layout: LayoutFlags;
  readonly footer: FooterFlags;
  readonly titles: TitleModel;
  readonly setFieldUntyped: (k: string, v: unknown) => void;
  readonly patchForExtension: (partial: Readonly<Record<string, unknown>>) => void;
};

export type SectionRenderContext<TValues extends FormValues, TCtx = unknown> = {
  readonly model: RenderEditModel<TValues, TCtx>;
  readonly sectionIndex: number;
  readonly sectionActionsEl: ReactNode;
  readonly wrapWizardStep: (key: string, el: ReactNode) => ReactNode;
};

export type FieldsSection = Extract<EditSectionViewModel, { readonly kind: "fields" }>;
