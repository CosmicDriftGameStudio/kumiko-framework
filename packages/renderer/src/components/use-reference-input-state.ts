import type { EntityEditScreenDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { useCallback, useMemo, useState } from "react";
import { useAppFeatures } from "../app/app-features-context.tsx";
import { screenAccessAllows } from "../app/screen-access.ts";
import { useUserRoles } from "../context/user-roles-context.tsx";
import { rendererError } from "../dev-console.ts";
import type { EditFieldViewModel } from "../headless/index.ts";
import { REFERENCE_COMBOBOX_LIMIT } from "../hooks/reference-limits.ts";
import { useQuery } from "../hooks/use-query.ts";
import {
  referenceOptionSource,
  referenceRowsByIdsPayload,
  withUnlistedSelectedRows,
} from "../hooks/use-reference-lookup.ts";
import { selectedReferenceIds, stringArrayOf } from "./render-field-values.ts";

export function useReferenceInputState(
  field: EditFieldViewModel,
  featureName: string,
  onChange: (value: unknown) => void,
) {
  const refEntity = field.refEntity ?? "";
  const refFeature = field.refFeature ?? featureName;
  const isMultiple = field.refMultiple === true;
  // refFeature may differ from featureName (for example,
  // items.assignee → users:query:user:list). The default is the same feature,
  // as provided by the ViewModel (parseRefTarget).
  // refOptionsQuery replaces that source with an author-supplied handler whose
  // rows already carry a composed `label`.
  const { queryQn, labelKey } = referenceOptionSource(field, refFeature, refEntity);
  // "+ Neu" in the combobox opens the referenced entity's create screen in a
  // dialog instead of leaving the current form.
  // refFeature may differ from the currently rendered feature; appFeatures
  // (createKumikoApp) knows all feature schemas, not only the active screen.
  // If the feature, screen, or entity is not registered, or allowCreate:false,
  // onCreate remains undefined and the combobox renders without the footer.
  const appFeatures = useAppFeatures();
  const userRoles = useUserRoles();
  const [createOpen, setCreateOpen] = useState(false);
  const refTargetSchema = appFeatures.find((f) => f.featureName === refFeature);
  const refCreateScreen = refTargetSchema?.screens.find(
    (s): s is EntityEditScreenDefinition =>
      s.type === "entityEdit" &&
      s.entity === refEntity &&
      s.allowCreate !== false &&
      screenAccessAllows(s.access, userRoles),
  );
  const refEntityDef = refTargetSchema?.entities[refEntity];
  // When the user types in the combobox, the server filters through the
  // existing list-payload `search` parameter. The combobox debounces the
  // keystroke itself (300ms) and calls onSearchChange.
  // An empty initial state requests the first 50 items in default order.
  const [searchTerm, setSearchTerm] = useState("");
  const queryPayload = useMemo<Record<string, unknown>>(
    () =>
      searchTerm === ""
        ? { limit: REFERENCE_COMBOBOX_LIMIT }
        : { limit: REFERENCE_COMBOBOX_LIMIT, search: searchTerm },
    [searchTerm],
  );
  const queryResult = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(
    queryQn,
    queryPayload,
  );
  // The first page can miss the stored value; without its row the combobox shows no label.
  const selectedIds = selectedReferenceIds(field);
  const selectedResult = useQuery<{ rows: ReadonlyArray<Record<string, unknown>> }>(
    queryQn,
    referenceRowsByIdsPayload(selectedIds, REFERENCE_COMBOBOX_LIMIT),
    { enabled: field.refOptionsQuery === undefined && selectedIds.length > 0 },
  );
  const handleSearchChange = useCallback((q: string) => setSearchTerm(q), []);
  const createTarget =
    !field.readOnly && refCreateScreen !== undefined && refEntityDef !== undefined
      ? { screen: refCreateScreen, entity: refEntityDef }
      : undefined;
  const [createdWithoutIdWarning, setCreatedWithoutIdWarning] = useState(false);
  const handleCreated = useCallback(
    (newId: string | undefined) => {
      setCreateOpen(false);
      // Clear the search filter before refetching — the just-created record
      // won't match whatever the user had typed pre-create, and would then
      // be missing from `options` (shown as a raw id instead of a label).
      setSearchTerm("");
      queryResult.refetch().catch((err: unknown) => {
        rendererError("render-field: refetch after create failed", err);
      });
      // Record was created server-side but the payload carried no id —
      // can't auto-select it, surface that instead of failing silently.
      setCreatedWithoutIdWarning(newId === undefined);
      if (newId !== undefined) {
        onChange(isMultiple ? [...stringArrayOf(field.value), newId] : newId);
      }
    },
    [isMultiple, field.value, onChange, queryResult.refetch],
  );
  const options = useMemo(() => {
    const rows = withUnlistedSelectedRows(
      queryResult.data?.rows ?? [],
      selectedResult.data?.rows ?? [],
    );
    return rows.map((row) => {
      const idVal = String(row["id"] ?? "");
      const label = String(row[labelKey] ?? idVal);
      return { value: idVal, label };
    });
  }, [queryResult.data, selectedResult.data, labelKey]);
  return {
    refFeature,
    isMultiple,
    options,
    loading: queryResult.loading,
    createTarget,
    createOpen,
    setCreateOpen,
    createdWithoutIdWarning,
    handleCreated,
    handleSearchChange,
  };
}
