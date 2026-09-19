import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  EditExtensionSection,
  EditFieldSpec,
  EditFieldsSection,
  EditSectionSpec,
  EditWriteFormSection,
  EntityEditScreenDefinition,
  FieldCondition,
  FormatSpec,
  ListColumnSpec,
  ProjectionDetailScreenDefinition,
  RowAction,
  ScreenDefinition,
  SecretMintScreenDefinition,
  ToolbarAction,
} from "./types/screen";

// Every screen type carrying `listScreenId` declares it identically; centralizing
// here keeps the switch the only place that grows for a new screen type.
export function explicitListScreenId(screen: ScreenDefinition): string | undefined {
  switch (screen.type) {
    case "custom":
    case "projectionDetail":
    case "entityEdit":
    case "actionForm":
    case "secretMint":
      return screen.listScreenId;
    default:
      return undefined;
  }
}

// Shared by the renderer breadcrumb and the boot-validator so both resolve
// parents the same way; `getId` lets each caller normalize `screen.id`.
export function resolveNavParentScreen(
  screens: readonly ScreenDefinition[],
  detail: ScreenDefinition,
  getId: (screen: ScreenDefinition) => string,
): ScreenDefinition | undefined {
  const detailScreenId = getId(detail);

  const listFromExplicit = ((): ScreenDefinition | undefined => {
    const explicitId = explicitListScreenId(detail);
    return explicitId !== undefined ? screens.find((s) => getId(s) === explicitId) : undefined;
  })();

  // rowActions, toolbarActions, and drawer-kind actions (which mount inline
  // and have no page of their own) all count as "reached from" this list.
  const navigatesToDetail = (
    actions: readonly (RowAction | ToolbarAction)[] | undefined,
  ): boolean =>
    (actions ?? []).some(
      (a) => (a.kind === "navigate" || a.kind === "drawer") && a.screen === detailScreenId,
    );
  const listFromRowAction = screens.find((s) => {
    if (s.type !== "entityList" && s.type !== "projectionList") return false;
    return navigatesToDetail(s.rowActions) || navigatesToDetail(s.toolbarActions);
  });

  const listFromEntity =
    detail.type === "entityEdit"
      ? screens.find((s) => s.type === "entityList" && s.entity === detail.entity)
      : undefined;

  return listFromExplicit ?? listFromRowAction ?? listFromEntity;
}

export type EditLayoutScreen =
  | ProjectionDetailScreenDefinition
  | EntityEditScreenDefinition
  | ActionFormScreenDefinition
  | ConfigEditScreenDefinition
  | SecretMintScreenDefinition;

// Shared by boot-validators that walk the EditLayout shape (entityEdit's
// layout, reused verbatim by projectionDetail/actionForm/configEdit/secretMint).
export function isEditLayoutScreen(screen: ScreenDefinition): screen is EditLayoutScreen {
  return (
    screen.type === "projectionDetail" ||
    screen.type === "entityEdit" ||
    screen.type === "actionForm" ||
    screen.type === "configEdit" ||
    screen.type === "secretMint"
  );
}

export function isExtensionEditSection(section: EditSectionSpec): section is EditExtensionSection {
  return section.kind === "extension";
}

export function isFieldsEditSection(section: EditSectionSpec): section is EditFieldsSection {
  return section.kind === undefined || section.kind === "fields";
}

export function isWriteFormEditSection(section: EditSectionSpec): section is EditWriteFormSection {
  return section.kind === "writeForm";
}

/** Structural shape of every section that can carry `fields` and/or `groups` —
 *  matches EditWriteFormSection (no `groups`) too, so callers need no narrowing. */
export type FieldsOrGroupsSection = {
  readonly fields: readonly EditFieldSpec[];
  readonly groups?: readonly {
    readonly title: string;
    readonly fields: readonly EditFieldSpec[];
  }[];
};

// Union of both sources, unlike the boot-validator's either-or flattening: that
// one runs after the fields-XOR-groups check, collectors run without it and must
// not drop a source (fw#2986).
export function sectionFieldSpecs(section: FieldsOrGroupsSection): readonly EditFieldSpec[] {
  return [...section.fields, ...(section.groups?.flatMap((group) => group.fields) ?? [])];
}

// Type guard — narrows FieldRenderer to FormatSpec. Useful for renderer
// authors who branch on the three FieldRenderer variants without manual
// "format" in renderer checks.
export function isFormatSpec(r: unknown): r is FormatSpec {
  return typeof r === "object" && r !== null && "format" in r && typeof r.format === "string";
}

// Collapse the string-shorthand into the object form. Both the boot-validator
// and (later) ui-core's view-model builder iterate over fields/columns — the
// helper keeps that loop from growing two branches everywhere.
export function normalizeListColumn(c: ListColumnSpec): Exclude<ListColumnSpec, string> {
  const col = typeof c === "string" ? { field: c } : c;
  if (
    typeof process !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    col.renderer !== undefined &&
    typeof col.renderer === "function"
  ) {
    // biome-ignore lint/suspicious/noConsole: dev-only warning
    console.warn(
      `[kumiko] normalizeListColumn: Feld "${col.field}" hat einen Funktions-Renderer — dieser wird von JSON.stringify verworfen. Bitte auf FormatSpec ({ format: "..." }) migrieren.`,
    );
  }
  return col;
}

/** Evaluates a declarative FieldCondition against the current row/form
 *  values. THE single implementation — renderer (row-action visibility),
 *  headless view-model (visible/readOnly/required) and render-edit
 *  (form-condition closures) reuse it; three hand-rolled copies had
 *  already drifted in shape. */
export function evalFieldCondition(cond: FieldCondition, values: Record<string, unknown>): boolean {
  if (typeof cond === "boolean") return cond;
  const val = values[cond.field];
  if ("eq" in cond) return val === cond.eq;
  if ("in" in cond) return cond.in.includes(val);
  if ("notIn" in cond) return !cond.notIn.includes(val);
  return val !== cond.ne;
}

export function normalizeEditField(f: EditFieldSpec): Exclude<EditFieldSpec, string> {
  return typeof f === "string" ? { field: f } : f;
}
