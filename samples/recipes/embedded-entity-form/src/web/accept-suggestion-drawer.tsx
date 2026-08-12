import type { RenderEditControls } from "@cosmicdrift/kumiko-renderer";
import { RenderEdit, useDispatcher, usePrimitives } from "@cosmicdrift/kumiko-renderer";
import { Drawer } from "@cosmicdrift/kumiko-renderer-web";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { prospectEntity } from "../entities/prospect";
import { prospectAcceptScreen } from "../screens/prospect-accept-screen";

const acceptSchema = z.object({
  name: z.string().min(1),
  email: z.union([z.email(), z.literal("")]).optional(),
  company: z.string().optional(),
  notes: z.string().optional(),
});

type FormFields = {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly notes: string;
};

export type Suggestion = {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  readonly company?: string;
  readonly notes?: string;
};

// The create handler's success payload is `{ id, ... }` (see prospect:accept
// in feature.ts) but RenderEdit's onSubmit only types it as `unknown` —
// narrow defensively instead of casting through it.
function extractProspectId(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const id = (data as Record<string, unknown>)["id"];
  return typeof id === "string" ? id : undefined;
}

function toFormFields(suggestion: Suggestion): FormFields {
  return {
    name: suggestion.name,
    email: suggestion.email ?? "",
    company: suggestion.company ?? "",
    notes: suggestion.notes ?? "",
  };
}

export type AcceptSuggestionDrawerProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly suggestion: Suggestion;
  readonly onAccepted: (prospectId: string | undefined) => void;
};

// Hosts the prospect create-form inside a Drawer next to the suggestion it
// came from — no dedicated screen/route, prefilled from the suggestion
// (an external source, not this entity's own detail query), and saved
// through `prospect:accept` instead of the built-in CRUD create.
export function AcceptSuggestionDrawer({
  open,
  onOpenChange,
  suggestion,
  onAccepted,
}: AcceptSuggestionDrawerProps): ReactNode {
  const { Button } = usePrimitives();
  const dispatcher = useDispatcher();
  const controls = useRef<RenderEditControls<FormFields> | null>(null);
  const [live, setLive] = useState({ dirty: false, valid: true });
  const initial = useMemo(() => toFormFields(suggestion), [suggestion]);

  if (!open) return null;
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title="Accept suggestion"
      description={
        !live.valid
          ? "Please fill in required fields"
          : live.dirty
            ? "Unsaved changes"
            : "Unchanged from the suggestion"
      }
      footer={
        <Button
          variant="secondary"
          onClick={() => {
            controls.current?.patch(initial);
            controls.current?.validate();
          }}
        >
          Restore AI suggestion
        </Button>
      }
    >
      <RenderEdit
        screen={prospectAcceptScreen}
        entity={prospectEntity}
        featureName="prospects"
        initial={initial}
        entityId={null}
        schema={acceptSchema}
        onChange={({ dirty, valid }) => setLive({ dirty, valid })}
        onControlsReady={(next) => {
          controls.current = next;
        }}
        customSubmit={async (snapshot) => {
          const result = await dispatcher.write("prospects:write:prospect:accept", {
            suggestionId: suggestion.id,
            changes: snapshot.changes,
          });
          return { validationBlocked: false, ...result };
        }}
        onSubmit={(result) => {
          if (result.validationBlocked || !result.isSuccess) return;
          onAccepted(extractProspectId(result.data));
          onOpenChange(false);
        }}
        onCancel={() => onOpenChange(false)}
      />
    </Drawer>
  );
}
