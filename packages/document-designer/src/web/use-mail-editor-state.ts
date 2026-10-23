import { TemplateResolverQueries } from "@cosmicdrift/kumiko-bundled-features/template-resolver/web";
import { useQuery, useUnsavedInputSource } from "@cosmicdrift/kumiko-renderer";
import { useEffect, useRef, useState } from "react";
import { buildMeta, isDraftDirty, parseJsonRecord, pickDeclaredVariables } from "./mail-draft.ts";
import type { MailEditorBodyProps } from "./mail-editor-logic.ts";
import { buildMailModel } from "./mail-editor-model.ts";
import type { MailValidation, PickedValues } from "./mail-types.ts";
import { useMailServices, useMailUiState } from "./use-mail-editor-parts.ts";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

export function useMailEditorState(props: MailEditorBodyProps, t: Translate) {
  const { slug, locale, isSystemAdmin, row } = props;
  const ui = useMailUiState(row);
  const [picked, setPicked] = useState<PickedValues | null>(null);
  const services = useMailServices(props);

  const locked = row === null && !ui.creating;
  const variableSchema = parseJsonRecord(row?.variableSchema);
  const validation = useQuery<MailValidation>(TemplateResolverQueries.validate, {
    slug,
    kind: "mail",
    contentFormat: "html",
    content: ui.settled.body,
    meta: buildMeta(ui.settled),
    variableSchema,
    locale,
    scope: isSystemAdmin ? "system" : "tenant",
  }).data;

  const pickedVariables = pickDeclaredVariables(picked, validation?.variables);

  // A pick belongs to the variables it was made for: after the declared set changes it is dropped,
  // so a re-added variable does not revive an old record value.
  const declaredVariables = validation?.variables;
  const declaredVariableNames =
    declaredVariables === undefined ? null : Object.keys(declaredVariables).sort().join("|");
  const previousDeclaredNames = useRef(declaredVariableNames);
  useEffect(() => {
    // skip: validation has not loaded, so there is no declared set to compare
    if (declaredVariableNames === null) return;
    if (
      previousDeclaredNames.current !== null &&
      previousDeclaredNames.current !== declaredVariableNames
    ) {
      setPicked(null);
    }
    previousDeclaredNames.current = declaredVariableNames;
  }, [declaredVariableNames]);

  const dirty = isDraftDirty(ui.draft, ui.baseline);
  useUnsavedInputSource(() => dirty);

  return buildMailModel({
    props,
    t,
    ui,
    picked,
    setPicked,
    services,
    validation,
    variableSchema,
    pickedVariables,
    locked,
    dirty,
  });
}
