import type {
  EntityDefinition,
  EntityEditScreenDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { FormValues, SubmitResult, Translate } from "@cosmicdrift/kumiko-headless";
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
  readonly onCreated: (id: string) => void;
  readonly featureName: string;
  readonly screen: EntityEditScreenDefinition;
  readonly entity: EntityDefinition;
  readonly translate?: Translate;
};

export function ReferenceCreateDialog({
  open,
  onClose,
  onCreated,
  featureName,
  screen,
  entity,
  translate,
}: ReferenceCreateDialogProps): ReactNode {
  const { Modal } = usePrimitives();
  const t = useTranslation();
  const initial = useMemo(() => buildInitialValues(entity.fields) as FormValues, [entity.fields]);
  const writeCommand = entityWriteCommand(featureName, screen.entity);
  const handleSubmitted = (result: SubmitResult<unknown>): void => {
    if (result.validationBlocked || !result.isSuccess) return;
    const id = extractCreatedId(result.data);
    if (id !== undefined) onCreated(id);
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
        {...(translate !== undefined && { translate })}
      />
    </Modal>
  );
}
