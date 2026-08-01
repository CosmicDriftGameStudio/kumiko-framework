import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FormValues, SubmitResult } from "@cosmicdrift/kumiko-headless";
import { type ReactNode, useMemo } from "react";
import { buildInitialValues } from "../app/kumiko-screen";
import { toKebab } from "../app/qn";
import { useTranslation } from "../i18n";
import { usePrimitives } from "../primitives";
import { RenderEdit } from "./render-edit";

// Hosts a target entity's create-form inside a bare Modal so a reference
// field can create a missing record without leaving the current form
// (kumiko-framework#1681) — same create wiring as EntityEditCreateBody
// (kumiko-screen.tsx), but reports the new id back via a callback instead
// of navigating to the entity's list screen.

function entityWriteCommand(featureName: string, entity: string): string {
  return `${toKebab(featureName)}:write:${toKebab(entity)}:create`;
}

// The create handler's success payload is `{ kind: "save", id, ... }`
// (see event-store-executor-write.ts) but RenderEdit's onSubmit only
// types it as `unknown` — narrow defensively instead of casting through it.
function extractCreatedId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const id = (data as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : undefined;
}

export type ReferenceCreateDialogProps = {
  readonly open: boolean;
  readonly onClose: () => void;
  // id is undefined when the record was created but the write-handler's
  // success payload carried no `id` (custom create-handler variant) — the
  // record already exists server-side, so this is still a success signal
  // to the caller, just one it can't auto-select from (#1694).
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
  const { Modal } = usePrimitives();
  const t = useTranslation();
  const initial = useMemo(() => buildInitialValues(entity.fields) as FormValues, [entity.fields]);
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
    </Modal>
  );
}
