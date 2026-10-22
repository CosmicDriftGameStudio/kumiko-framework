import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { type ReactNode, useMemo } from "react";
import {
  buildInitialValues,
  tenantCurrencyMoneyFieldNames,
  useMoneyCurrencyOverrides,
} from "../app/entity-edit-prefill.ts";
import { toKebab } from "../app/qn.ts";
import type { SubmitResult } from "../headless/index.ts";
import { useTranslation } from "../i18n.tsx";
import { usePrimitives } from "../primitives.tsx";
import { RenderEdit } from "./render-edit.tsx";

// Hosts a target entity's create-form inside a bare Modal so a reference
// field can create a missing record without leaving the current form
// — same create wiring as EntityEditCreateBody
// (kumiko-screen.tsx), but reports the new id back via a callback instead
// of navigating to the entity's list screen.

function entityWriteCommand(featureName: string, entity: string): string {
  return `${toKebab(featureName)}:write:${toKebab(entity)}:create`;
}

// The create handler's success payload is `{ kind: "save", id, ... }`
// (see event-store-executor-write.ts) but RenderEdit's onSubmit only
// types it as `unknown` — narrow defensively instead of casting through it.
// `field` is author-declared (ActionFormRedirect.idFrom), never
// user input; the own-property check keeps a prototype key like
// "constructor" from resolving to anything.
export function extractIdField(data: unknown, field: string): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  if (!Object.hasOwn(data, field)) return undefined;
  const value = propertyOf(data, field);
  return typeof value === "string" ? value : undefined;
}

export function extractCreatedId(data: unknown): string | undefined {
  return extractIdField(data, "id");
}

export type ReferenceCreateDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  // id is undefined when the record was created but the write-handler's
  // success payload carried no `id` (custom create-handler variant) — the
  // record already exists server-side, so this is still a success signal
  // to the caller, just one it can't auto-select.
  readonly onCreated: (id: string | undefined) => void;
  readonly featureName: string;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
};

export function ReferenceCreateDialog({
  open,
  onClose,
  onCreated,
  featureName,
  screen,
  entity,
}: ReferenceCreateDialogProps): ReactNode {
  const { Banner, Modal } = usePrimitives();
  const t = useTranslation();
  const entityDefaultCurrency = entity.defaultCurrency ?? "EUR";
  const tenantCurrencyFieldNames = useMemo(
    () => (open ? tenantCurrencyMoneyFieldNames(entity.fields) : []),
    [open, entity.fields],
  );
  // Same tenant-currency resolution as the entityEdit create screen,
  // so a `currency: { kind: "tenant" }` field seeds identically via this dialog.
  const { overrides: moneyCurrencyOverrides, loading: currencyLoading } = useMoneyCurrencyOverrides(
    entity.fields,
    tenantCurrencyFieldNames,
    entityDefaultCurrency,
  );
  const initial = useMemo(
    () => buildInitialValues(entity.fields, entityDefaultCurrency, moneyCurrencyOverrides),
    [entity.fields, entityDefaultCurrency, moneyCurrencyOverrides],
  );
  const writeCommand = entityWriteCommand(featureName, screen.entity);
  const handleSubmitted = (result: SubmitResult<unknown>): void => {
    if (result.validationBlocked || !result.isSuccess) return;
    onCreated(extractCreatedId(result.data));
  };
  if (!open) return null;
  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={t("kumiko.actions.create")}
    >
      {currencyLoading ? (
        <Banner padded variant="loading" testId="reference-create-dialog-loading">
          {t("kumiko.widget.loading")}
        </Banner>
      ) : (
        <RenderEdit
          screen={screen}
          entity={entity}
          featureName={featureName}
          initial={initial}
          writeCommand={writeCommand}
          onSubmit={handleSubmitted}
          onCancel={onClose}
          {...(screen.submitLabel !== undefined && { submitLabel: screen.submitLabel })}
        />
      )}
    </Modal>
  );
}
