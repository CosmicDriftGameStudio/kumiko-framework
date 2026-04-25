import type {
  EntityDefinition,
  EntityEditScreenDefinition,
  FieldCondition,
} from "@kumiko/framework/ui-types";
import { normalizeEditField } from "@kumiko/framework/ui-types";
import { fieldLabelKey } from "./list";
import type { EditFieldViewModel, EditSectionViewModel, EditViewModel, Translate } from "./types";

export type ComputeEditViewModelInput<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  TCtx = unknown,
> = {
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly values: TValues;
  readonly translate: Translate;
  readonly featureName: string;
  // Optional condition context — forwarded to field visible/readonly/required
  // predicates. Normally the host app passes `{ user, config, ... }`.
  readonly ctx?: TCtx;
};

// Pure transform from screen-def + entity-def + row-values to the flat
// section/field tree the renderer draws. Conditional predicates are
// evaluated here so the renderer never re-runs them during React render.
//
// TValues / TCtx are propagated through evalCondition so call-sites can
// `computeEditViewModel<OrderRow, AdminCtx>(...)` and get typed data/ctx
// inside their predicates. Default `unknown` keeps unannotated call-sites
// working unchanged.
export function computeEditViewModel<
  TValues extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>,
  TCtx = unknown,
>(input: ComputeEditViewModelInput<TValues, TCtx>): EditViewModel {
  const { screen, entity, values, translate, featureName, ctx } = input;

  const sections: EditSectionViewModel[] = screen.layout.sections.map((sectionSpec) => {
    const fields: EditFieldViewModel[] = sectionSpec.fields.map((fieldSpec) => {
      const normalized = normalizeEditField(fieldSpec);
      const fieldDef = entity.fields[normalized.field];
      if (!fieldDef) {
        throw new Error(
          `computeEditViewModel: screen "${screen.id}" references unknown field "${normalized.field}" on entity "${screen.entity}"`,
        );
      }
      const label = translate(fieldLabelKey(featureName, screen.entity, normalized.field));
      const visible = evalCondition<TValues, TCtx>(normalized.visible, true, values, ctx);
      // `readOnly` (camelCase) is the name on both sides: EditFieldSpec
      // in the engine, and the view-model emitted here. One convention
      // through the stack beats translating at the boundary.
      const readOnly = evalCondition<TValues, TCtx>(normalized.readOnly, false, values, ctx);
      // `required` on the field-spec overrides the entity-default. A
      // field that's required at the entity-level but marked required:
      // false on the screen (e.g. a soft-onboarding wizard that
      // collects less up-front) respects the screen override.
      const entityRequired = (fieldDef as unknown as { required?: boolean }).required === true;
      const required = evalCondition<TValues, TCtx>(
        normalized.required,
        entityRequired,
        values,
        ctx,
      );
      // Select-Optionen bei `type: "select"` mitnehmen — der Renderer
      // braucht sie für das Dropdown ohne nochmal die EntityDefinition
      // zu reichen.
      const options =
        fieldDef.type === "select"
          ? ((fieldDef as unknown as { options?: readonly string[] }).options ?? [])
          : undefined;
      // Multiline-Hint bei `type: "text"` — der Renderer wechselt
      // dann auf textarea. ViewModel hält die Form-Render-Decision
      // damit der Renderer nicht selbst auf die FieldDefinition greift.
      const multiline =
        fieldDef.type === "text"
          ? (fieldDef as unknown as { multiline?: boolean | { rows?: number } }).multiline
          : undefined;
      const view: EditFieldViewModel = {
        field: normalized.field,
        label,
        type: fieldDef.type,
        value: values[normalized.field],
        visible,
        readOnly,
        required,
        ...(normalized.span !== undefined && { span: normalized.span }),
        ...(normalized.renderer !== undefined && { renderer: normalized.renderer }),
        ...(options !== undefined && { options }),
        ...(multiline !== undefined && { multiline }),
      };
      return view;
    });
    return {
      title: translate(sectionSpec.title),
      columns: sectionSpec.columns ?? 1,
      fields,
    };
  });

  const id = (values["id"] as string | undefined) ?? null;

  return {
    screenId: screen.id,
    entityName: screen.entity,
    id,
    sections,
    ...(screen.slots && { slots: screen.slots }),
  };
}

// Resolves a FieldCondition (undefined | predicate) into its boolean
// value against the current row values + ctx. `undefined` means "not
// declared" — caller substitutes the entity-level default.
//
// TValues / TCtx mirror the generics on FieldCondition. EditFieldSpec
// stores predicates as FieldCondition<unknown, unknown>, which is
// assignable to FieldCondition<TValues, TCtx> for any TValues/TCtx by
// parameter contravariance (a predicate that accepts `unknown` accepts
// anything). The cast on ctx is the one rough edge: input.ctx is
// optional, so at runtime we may pass undefined to a predicate that
// declared a concrete TCtx — the caller is responsible for not doing
// that when they narrow TCtx away from `unknown`.
function evalCondition<TValues, TCtx>(
  condition: FieldCondition<TValues, TCtx> | undefined,
  fallback: boolean,
  values: TValues,
  ctx: TCtx | undefined,
): boolean {
  if (condition === undefined) return fallback;
  return condition(values, ctx as TCtx);
}
